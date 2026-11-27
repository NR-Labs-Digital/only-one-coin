import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { backupRestores } from "@ooc/db";
import type {
  BackupRestoreFailure,
  BackupRestoreReport,
  BackupRestoreStatus,
  BackupRestoreView,
  ClaimedBackupRestore,
  IBackupRestoreRepository,
} from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

const RUNNING: BackupRestoreStatus[] = ["restoring", "validating"];

interface RawRestoreRow extends Record<string, unknown> {
  id: string;
  backupKey: string;
  databaseName: string;
  status: BackupRestoreStatus;
  failureReason: BackupRestoreFailure | null;
  report: BackupRestoreReport | null;
  requestedBy: string;
  requestedByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  discardedAt: string | null;
  discardedByName: string | null;
}

const date = (value: string | null): Date | null => (value ? new Date(value) : null);

/** `backup_restores` (OOC-153, `0083`). */
export class DrizzleBackupRestoreRepository implements IBackupRestoreRepository {
  constructor(private readonly db: Db) {}

  async createQueued(input: {
    id: string;
    backupKey: string;
    databaseName: string;
    requestedBy: string;
  }): Promise<boolean> {
    // The partial unique index keeps one open restore; a second insert is a
    // conflict on it, answered as "already open" rather than raised.
    const inserted = await this.db
      .insert(backupRestores)
      .values({ ...input, status: "queued" })
      .onConflictDoNothing()
      .returning({ id: backupRestores.id });
    return inserted.length === 1;
  }

  async find(id: string): Promise<BackupRestoreView | null> {
    const rows = await this.select(sql`where r."id" = ${id}`, 1);
    return rows[0] ?? null;
  }

  listRecent(limit: number): Promise<BackupRestoreView[]> {
    return this.select(sql``, limit);
  }

  async claimNext(now: Date): Promise<ClaimedBackupRestore | null> {
    const result = await this.db.execute<{
      id: string;
      backupKey: string;
      databaseName: string;
      requestedBy: string;
    }>(sql`
      update backup_restores
      set status = 'restoring', started_at = ${now}, heartbeat_at = ${now}, updated_at = ${now}
      where id = (
        select id from backup_restores
        where status = 'queued'
        order by created_at
        limit 1
        for update skip locked
      )
      returning id, backup_key as "backupKey", database_name as "databaseName", requested_by as "requestedBy"
    `);
    return result.rows[0] ?? null;
  }

  async listStale(before: Date): Promise<ClaimedBackupRestore[]> {
    return this.db
      .select({
        id: backupRestores.id,
        backupKey: backupRestores.backupKey,
        databaseName: backupRestores.databaseName,
        requestedBy: backupRestores.requestedBy,
      })
      .from(backupRestores)
      .where(and(inArray(backupRestores.status, RUNNING), lt(backupRestores.heartbeatAt, before)));
  }

  async heartbeat(id: string, now: Date): Promise<void> {
    await this.db
      .update(backupRestores)
      .set({ heartbeatAt: now, updatedAt: now })
      .where(and(eq(backupRestores.id, id), inArray(backupRestores.status, RUNNING)));
  }

  async markValidating(id: string, now: Date): Promise<void> {
    await this.db
      .update(backupRestores)
      .set({ status: "validating", heartbeatAt: now, updatedAt: now })
      .where(and(eq(backupRestores.id, id), eq(backupRestores.status, "restoring")));
  }

  async markPassed(id: string, report: BackupRestoreReport, now: Date): Promise<void> {
    await this.db
      .update(backupRestores)
      .set({ status: "passed", report, finishedAt: now, updatedAt: now })
      .where(and(eq(backupRestores.id, id), eq(backupRestores.status, "validating")));
  }

  async markFailed(
    id: string,
    reason: BackupRestoreFailure,
    report: BackupRestoreReport | null,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(backupRestores)
      .set({ status: "failed", failureReason: reason, report, finishedAt: now, updatedAt: now })
      .where(and(eq(backupRestores.id, id), inArray(backupRestores.status, RUNNING)))
      .returning({ id: backupRestores.id });
    return updated.length === 1;
  }

  async markDiscarded(id: string, actorId: string, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(backupRestores)
      .set({ status: "discarded", discardedAt: now, discardedBy: actorId, updatedAt: now })
      .where(and(eq(backupRestores.id, id), eq(backupRestores.status, "passed")))
      .returning({ id: backupRestores.id });
    return updated.length === 1;
  }

  async productionCounts(tables: readonly string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      // Names come from the domain's fixed list, never from a request.
      const result = await this.db.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)}`);
      counts[table] = Number(result.rows[0]?.n ?? 0);
    }
    return counts;
  }

  /**
   * Raw SQL only for the join: "user" is Better Auth's own table and is not
   * modeled in packages/db (DrizzleFeatureFlagOverrideRepository carries the
   * same note).
   */
  private async select(where: ReturnType<typeof sql>, limit: number): Promise<BackupRestoreView[]> {
    const result = await this.db.execute<RawRestoreRow>(sql`
      select
        r."id",
        r."backup_key" as "backupKey",
        r."database_name" as "databaseName",
        r."status",
        r."failure_reason" as "failureReason",
        r."report",
        r."requested_by" as "requestedBy",
        requester."name" as "requestedByName",
        r."created_at" as "createdAt",
        r."started_at" as "startedAt",
        r."finished_at" as "finishedAt",
        r."discarded_at" as "discardedAt",
        discarder."name" as "discardedByName"
      from backup_restores r
      left join "user" requester on requester."id" = r."requested_by"
      left join "user" discarder on discarder."id" = r."discarded_by"
      ${where}
      order by r."created_at" desc
      limit ${limit}
    `);
    return result.rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      startedAt: date(row.startedAt),
      finishedAt: date(row.finishedAt),
      discardedAt: date(row.discardedAt),
    }));
  }
}
