// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import { isOwnerEmail } from "../../identity/Role.js";
import { NotAPlatformOwnerError } from "../errors.js";
import type { IAuditLogRepository } from "../../identity/ports/IAuditLogRepository.js";
import {
  BACKUP_NEVER_SHRINKING_TABLES,
  checkRestoredBackup,
  isBackupKey,
  restoreDatabaseName,
  type BackupFile,
  type BackupRestoreFailure,
  type BackupRestoreReport,
  type BackupRestoreView,
} from "./BackupRestore.js";
import {
  BackupNotFoundError,
  BackupRestoreAlreadyOpenError,
  BackupRestoreConfirmationMismatchError,
  BackupRestoreNotConfiguredError,
  BackupRestoreNotDiscardableError,
  BackupRestoreNotFoundError,
} from "./errors.js";
import type { IBackupRestoreRepository, ClaimedBackupRestore } from "./ports/IBackupRestoreRepository.js";
import type { IBackupStore } from "./ports/IBackupStore.js";
import { DumpRestoreError, type IDumpRestorer } from "./ports/IDumpRestorer.js";
import type { IRestoreTarget } from "./ports/IRestoreTarget.js";

/**
 * What this environment can do. Each half is optional config (no Fly secret
 * is required for a deploy): without a bucket nothing lists, and without a
 * restore target nothing restores — the screen says which.
 */
export interface BackupRestoreCapabilities {
  store: IBackupStore | null;
  target: IRestoreTarget | null;
  restorer: IDumpRestorer | null;
}

function assertOwner(email: string): void {
  if (!isOwnerEmail(email)) throw new NotAPlatformOwnerError();
}

export interface BackupsOverview {
  canList: boolean;
  canRestore: boolean;
  backups: BackupFile[];
  restores: BackupRestoreView[];
}

/** The owners' backups screen: what the bucket has and what was restored from it. */
export class GetBackupsOverviewUseCase extends BaseUseCase<{ actorEmail: string }, BackupsOverview> {
  constructor(
    private readonly capabilities: BackupRestoreCapabilities,
    private readonly restores: IBackupRestoreRepository,
  ) {
    super();
  }

  async run(input: { actorEmail: string }): Promise<BackupsOverview> {
    assertOwner(input.actorEmail);
    const { store, target, restorer } = this.capabilities;
    const [backups, restores] = await Promise.all([
      store ? store.list() : Promise.resolve([]),
      this.restores.listRecent(20),
    ]);
    return { canList: store !== null, canRestore: store !== null && target !== null && restorer !== null, backups, restores };
  }
}

export interface RequestBackupRestoreInput {
  actorId: string;
  actorEmail: string;
  backupKey: string;
  /** The backup's name, typed again by whoever asks. */
  confirmation: string;
}

/**
 * Queues a restore (OOC-153). Owners only, by e-mail like Funcionalidades —
 * checked at the route and again here. The work itself runs in the worker,
 * never in the request.
 */
export class RequestBackupRestoreUseCase extends BaseUseCase<RequestBackupRestoreInput, { id: string }> {
  constructor(
    private readonly capabilities: BackupRestoreCapabilities,
    private readonly restores: IBackupRestoreRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RequestBackupRestoreInput): Promise<{ id: string }> {
    assertOwner(input.actorEmail);
    const { store, target, restorer } = this.capabilities;
    if (!store || !target || !restorer) throw new BackupRestoreNotConfiguredError();

    if (input.confirmation !== input.backupKey) {
      throw new BackupRestoreConfirmationMismatchError({ path: "confirmation" });
    }
    if (!isBackupKey(input.backupKey) || !(await store.exists(input.backupKey))) {
      throw new BackupNotFoundError({ path: "backupKey" });
    }

    const id = uuid();
    const databaseName = restoreDatabaseName(id);
    const created = await this.restores.createQueued({
      id,
      backupKey: input.backupKey,
      databaseName,
      requestedBy: input.actorId,
    });
    if (!created) throw new BackupRestoreAlreadyOpenError();

    await this.auditLog.append({
      actorId: input.actorId,
      action: "backup_restore.requested",
      targetId: id,
      metadata: { backupKey: input.backupKey, databaseName },
      at: new Date(),
    });
    return { id };
  }
}

export interface DiscardBackupRestoreInput {
  actorId: string;
  actorEmail: string;
  restoreId: string;
}

/**
 * Drops the database a passed restore kept. Real student data does not stay
 * in a database nobody is looking at (docs/RESTAURAR-BACKUP.md, step 5).
 */
export class DiscardBackupRestoreUseCase extends BaseUseCase<DiscardBackupRestoreInput, void> {
  constructor(
    private readonly capabilities: BackupRestoreCapabilities,
    private readonly restores: IBackupRestoreRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: DiscardBackupRestoreInput): Promise<void> {
    assertOwner(input.actorEmail);
    const { target } = this.capabilities;
    if (!target) throw new BackupRestoreNotConfiguredError();

    const restore = await this.restores.find(input.restoreId);
    if (!restore) throw new BackupRestoreNotFoundError();
    if (restore.status !== "passed") throw new BackupRestoreNotDiscardableError();

    // Drop first: a row saying "discarded" over a database still standing is
    // the one outcome this must never leave behind.
    await target.drop(restore.databaseName);
    const moved = await this.restores.markDiscarded(restore.id, input.actorId, new Date());
    if (!moved) throw new BackupRestoreNotDiscardableError();

    await this.auditLog.append({
      actorId: input.actorId,
      action: "backup_restore.discarded",
      targetId: restore.id,
      metadata: { backupKey: restore.backupKey, databaseName: restore.databaseName },
      at: new Date(),
    });
  }
}

/** How long a running restore may go without a heartbeat before it counts as dead. */
export const BACKUP_RESTORE_STALE_AFTER_MS = 5 * 60_000;
const HEARTBEAT_EVERY_MS = 30_000;

export type RunBackupRestoreOutcome =
  | { kind: "idle" }
  | { kind: "passed"; restoreId: string; durationSeconds: number }
  | { kind: "failed"; restoreId: string; reason: BackupRestoreFailure; error?: unknown };

/**
 * One worker tick: closes restores a dead machine left running, then runs the
 * oldest queued one to the end.
 *
 * Production is never written. The dump goes into the scratch database only;
 * on any failure — the file, psql, a check — that database is dropped and the
 * row says why. Only a restore that passes every check keeps its database.
 */
export class RunNextBackupRestoreUseCase extends BaseUseCase<void, RunBackupRestoreOutcome> {
  constructor(
    private readonly capabilities: BackupRestoreCapabilities,
    private readonly restores: IBackupRestoreRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly repositoryMigrationStamps: number[],
    private readonly clock: () => Date = () => new Date(),
  ) {
    super();
  }

  async run(): Promise<RunBackupRestoreOutcome> {
    const { target, restorer } = this.capabilities;
    if (!target || !restorer) return { kind: "idle" };

    const now = this.clock();
    for (const stale of await this.restores.listStale(new Date(now.getTime() - BACKUP_RESTORE_STALE_AFTER_MS))) {
      await this.fail(stale, "interrupted", null, target);
    }

    const claimed = await this.restores.claimNext(this.clock());
    if (!claimed) return { kind: "idle" };

    const started = this.clock().getTime();
    const heartbeat = setInterval(() => {
      this.restores.heartbeat(claimed.id, this.clock()).catch(() => undefined);
    }, HEARTBEAT_EVERY_MS);

    try {
      let connectionUri: string;
      try {
        ({ connectionUri } = await target.create(claimed.databaseName));
      } catch (error) {
        await this.fail(claimed, "target_unavailable", null, target);
        return { kind: "failed", restoreId: claimed.id, reason: "target_unavailable", error };
      }

      try {
        await restorer.restore({ backupKey: claimed.backupKey, connectionUri });
      } catch (error) {
        const reason: BackupRestoreFailure = error instanceof DumpRestoreError ? error.reason : "unexpected_error";
        await this.fail(claimed, reason, null, target);
        return { kind: "failed", restoreId: claimed.id, reason, error };
      }

      await this.restores.markValidating(claimed.id, this.clock());
      const [inspection, productionCounts] = await Promise.all([
        restorer.inspect(connectionUri),
        this.restores.productionCounts(BACKUP_NEVER_SHRINKING_TABLES),
      ]);
      const checks = checkRestoredBackup({
        inspection,
        productionCounts,
        repositoryMigrationStamps: this.repositoryMigrationStamps,
      });
      const durationSeconds = Math.round((this.clock().getTime() - started) / 1000);
      const report: BackupRestoreReport = {
        rowCounts: inspection.rowCounts,
        productionCounts,
        migrationsInBackup: inspection.migrationStamps.length,
        migrationsInRepository: this.repositoryMigrationStamps.length,
        checks,
        durationSeconds,
      };

      if (checks.some((check) => !check.passed)) {
        await this.fail(claimed, "validation_failed", report, target);
        return { kind: "failed", restoreId: claimed.id, reason: "validation_failed" };
      }

      await this.restores.markPassed(claimed.id, report, this.clock());
      await this.auditLog.append({
        actorId: claimed.requestedBy,
        action: "backup_restore.passed",
        targetId: claimed.id,
        metadata: { backupKey: claimed.backupKey, databaseName: claimed.databaseName, durationSeconds },
        at: this.clock(),
      });
      return { kind: "passed", restoreId: claimed.id, durationSeconds };
    } catch (error) {
      await this.fail(claimed, "unexpected_error", null, target);
      return { kind: "failed", restoreId: claimed.id, reason: "unexpected_error", error };
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Drops the scratch database, then records why. The drop is best effort: a
   * database that never got created is already gone. */
  private async fail(
    restore: ClaimedBackupRestore,
    reason: BackupRestoreFailure,
    report: BackupRestoreReport | null,
    target: IRestoreTarget,
  ): Promise<void> {
    await target.drop(restore.databaseName).catch(() => undefined);
    const moved = await this.restores.markFailed(restore.id, reason, report, this.clock());
    if (!moved) return;
    await this.auditLog.append({
      actorId: restore.requestedBy,
      action: "backup_restore.failed",
      targetId: restore.id,
      metadata: { backupKey: restore.backupKey, databaseName: restore.databaseName, reason },
      at: this.clock(),
    });
  }
}
