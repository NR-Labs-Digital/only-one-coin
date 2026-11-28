import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  BackupNotFoundError,
  BackupRestoreAlreadyOpenError,
  BackupRestoreConfirmationMismatchError,
  BackupRestoreNotDiscardableError,
  DiscardBackupRestoreUseCase,
  DumpRestoreError,
  NotAPlatformOwnerError,
  RequestBackupRestoreUseCase,
  RunNextBackupRestoreUseCase,
  backupTakenAt,
  checkRestoredBackup,
  restoreDatabaseName,
  type AuditLogEntry,
  type BackupRestoreCapabilities,
  type BackupRestoreFailure,
  type BackupRestoreReport,
  type BackupRestoreView,
  type ClaimedBackupRestore,
  type IBackupRestoreRepository,
  type RestoredDatabaseInspection,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { createDumpFilter } from "@/infra/backup/dumpFilter.js";
import { libpqEnv } from "@/infra/backup/PsqlDumpRestorer.js";

/*
 * Restoring a backup into a scratch database (OOC-153). The rule that matters
 * most: production is never written, and a restore that fails anywhere — the
 * file, psql, a check — leaves no database behind.
 */

const KEY = "ooc-prod-20261120T101500Z.sql.gz";
const OWNER = { actorId: "owner-1", actorEmail: "dev@nrlabsdigital.com" };
const STAMPS = [100, 200, 300];

function healthyInspection(): RestoredDatabaseInspection {
  return {
    rowCounts: {
      students: 300,
      guardians: 40,
      enrollments: 500,
      payments: 480,
      class_groups: 30,
      courses: 12,
      teachers: 9,
      grades: 100,
      audit_log: 5000,
    },
    migrationStamps: [100, 200],
    appendOnlyLockHolds: true,
  };
}
const PRODUCTION = { students: 310, payments: 490, audit_log: 5100 };

describe("checkRestoredBackup", () => {
  it("passes a backup a little behind production", () => {
    const checks = checkRestoredBackup({
      inspection: healthyInspection(),
      productionCounts: PRODUCTION,
      repositoryMigrationStamps: STAMPS,
    });
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("fails a missing table, an empty one, and a table ahead of production", () => {
    const inspection = healthyInspection();
    inspection.rowCounts.grades = null;
    inspection.rowCounts.courses = 0;
    inspection.rowCounts.payments = 9999;
    const checks = checkRestoredBackup({ inspection, productionCounts: PRODUCTION, repositoryMigrationStamps: STAMPS });
    const byKey = Object.fromEntries(checks.map((check) => [check.check, check]));
    expect(byKey.tables_present).toEqual({ check: "tables_present", passed: false, tables: ["grades"] });
    expect(byKey.tables_not_empty).toEqual({ check: "tables_not_empty", passed: false, tables: ["courses"] });
    expect(byKey.not_ahead_of_production).toEqual({
      check: "not_ahead_of_production",
      passed: false,
      tables: ["payments"],
    });
  });

  it("passes a backup whose older stamp differs, as long as the newest is in the journal", () => {
    const checks = checkRestoredBackup({
      inspection: { ...healthyInspection(), migrationStamps: [100, 150, 300] },
      productionCounts: PRODUCTION,
      repositoryMigrationStamps: STAMPS,
    });
    expect(checks.find((check) => check.check === "migrations_match_repository")?.passed).toBe(true);
  });

  it("fails no migrations, a newest one off the journal, and more than the repository has", () => {
    for (const migrationStamps of [[], [100, 250], [100, 200, 300, 300]]) {
      const checks = checkRestoredBackup({
        inspection: { ...healthyInspection(), migrationStamps },
        productionCounts: PRODUCTION,
        repositoryMigrationStamps: STAMPS,
      });
      expect(checks.find((check) => check.check === "migrations_match_repository")?.passed).toBe(false);
    }
  });

  it("fails when the append-only trigger did not come back", () => {
    const checks = checkRestoredBackup({
      inspection: { ...healthyInspection(), appendOnlyLockHolds: false },
      productionCounts: PRODUCTION,
      repositoryMigrationStamps: STAMPS,
    });
    expect(checks.find((check) => check.check === "append_only_lock")?.passed).toBe(false);
  });
});

describe("backup names", () => {
  it("reads the UTC instant off the name", () => {
    expect(backupTakenAt(KEY)?.toISOString()).toBe("2026-11-20T10:15:00.000Z");
    expect(backupTakenAt("ooc-prod-latest.sql.gz")).toBeNull();
  });

  it("derives a database name Postgres accepts", () => {
    expect(restoreDatabaseName("0195f1d2-3c4b-7a00-8f00-1234567890ab")).toBe("ooc_restore_1234567890ab");
  });
});

class FakeRestores implements IBackupRestoreRepository {
  rows = new Map<string, BackupRestoreView>();
  created: { id: string; backupKey: string; databaseName: string; requestedBy: string }[] = [];

  async createQueued(input: { id: string; backupKey: string; databaseName: string; requestedBy: string }) {
    if ([...this.rows.values()].some((row) => ["queued", "restoring", "validating", "passed"].includes(row.status))) {
      return false;
    }
    this.created.push(input);
    this.rows.set(input.id, {
      ...input,
      status: "queued",
      failureReason: null,
      report: null,
      requestedByName: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      discardedAt: null,
      discardedByName: null,
    });
    return true;
  }
  async find(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listRecent() {
    return [...this.rows.values()];
  }
  async claimNext(): Promise<ClaimedBackupRestore | null> {
    const row = [...this.rows.values()].find((candidate) => candidate.status === "queued");
    if (!row) return null;
    row.status = "restoring";
    return { id: row.id, backupKey: row.backupKey, databaseName: row.databaseName, requestedBy: row.requestedBy };
  }
  stale: ClaimedBackupRestore[] = [];
  async listStale() {
    return this.stale;
  }
  async heartbeat() {}
  async markValidating(id: string) {
    this.rows.get(id)!.status = "validating";
  }
  async markPassed(id: string, report: BackupRestoreReport) {
    Object.assign(this.rows.get(id)!, { status: "passed", report });
  }
  async markFailed(id: string, reason: BackupRestoreFailure, report: BackupRestoreReport | null) {
    const row = this.rows.get(id);
    if (!row || !["restoring", "validating"].includes(row.status)) return false;
    Object.assign(row, { status: "failed", failureReason: reason, report });
    return true;
  }
  async markDiscarded(id: string) {
    const row = this.rows.get(id);
    if (!row || row.status !== "passed") return false;
    row.status = "discarded";
    return true;
  }
  async productionCounts() {
    return PRODUCTION;
  }
}

function setup(options: { restoreError?: Error; inspection?: RestoredDatabaseInspection; exists?: boolean } = {}) {
  const restores = new FakeRestores();
  const audit: AuditLogEntry[] = [];
  const created: string[] = [];
  const dropped: string[] = [];
  const restored: string[] = [];
  const capabilities: BackupRestoreCapabilities = {
    store: { list: async () => [], exists: async () => options.exists ?? true },
    target: {
      create: async (name) => {
        created.push(name);
        return { connectionUri: `postgres://scratch/${name}` };
      },
      connectionUri: async (name) => `postgres://scratch/${name}`,
      drop: async (name) => {
        dropped.push(name);
      },
    },
    restorer: {
      restore: async ({ connectionUri }) => {
        if (options.restoreError) throw options.restoreError;
        restored.push(connectionUri);
      },
      inspect: async () => options.inspection ?? healthyInspection(),
    },
  };
  const auditLog = { append: async (entry: AuditLogEntry) => void audit.push(entry) };
  return {
    restores,
    audit,
    created,
    dropped,
    restored,
    request: new RequestBackupRestoreUseCase(capabilities, restores, auditLog),
    discard: new DiscardBackupRestoreUseCase(capabilities, restores, auditLog),
    runNext: new RunNextBackupRestoreUseCase(capabilities, restores, auditLog, STAMPS),
  };
}

describe("RequestBackupRestoreUseCase", () => {
  it("refuses an account outside the owners' domains, whatever its cargo", async () => {
    const { request } = setup();
    await expect(
      request.run({ actorId: "a", actorEmail: "admin@onlyonecoin.edu.pe", backupKey: KEY, confirmation: KEY }),
    ).rejects.toBeInstanceOf(NotAPlatformOwnerError);
  });

  it("refuses a confirmation that is not the backup's name", async () => {
    const { request } = setup();
    await expect(request.run({ ...OWNER, backupKey: KEY, confirmation: "ooc-prod" })).rejects.toBeInstanceOf(
      BackupRestoreConfirmationMismatchError,
    );
  });

  it("refuses a name the deploy never writes, and one gone from the bucket", async () => {
    await expect(
      setup().request.run({ ...OWNER, backupKey: "../etc/passwd", confirmation: "../etc/passwd" }),
    ).rejects.toBeInstanceOf(BackupNotFoundError);
    await expect(
      setup({ exists: false }).request.run({ ...OWNER, backupKey: KEY, confirmation: KEY }),
    ).rejects.toBeInstanceOf(BackupNotFoundError);
  });

  it("queues one restore at a time and audits it", async () => {
    const { request, audit } = setup();
    await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });
    await expect(request.run({ ...OWNER, backupKey: KEY, confirmation: KEY })).rejects.toBeInstanceOf(
      BackupRestoreAlreadyOpenError,
    );
    expect(audit.map((entry) => entry.action)).toEqual(["backup_restore.requested"]);
  });
});

describe("RunNextBackupRestoreUseCase", () => {
  it("keeps the database of a restore that passes every check", async () => {
    const { request, runNext, restores, dropped, audit } = setup();
    const { id } = await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });

    const outcome = await runNext.run();

    expect(outcome.kind).toBe("passed");
    expect(restores.rows.get(id)?.status).toBe("passed");
    expect(restores.rows.get(id)?.report?.checks.every((check) => check.passed)).toBe(true);
    expect(dropped).toEqual([]);
    expect(audit.map((entry) => entry.action)).toEqual(["backup_restore.requested", "backup_restore.passed"]);
  });

  it("drops the database of a restore that fails a check", async () => {
    const { request, runNext, restores, dropped } = setup({
      inspection: { ...healthyInspection(), appendOnlyLockHolds: false },
    });
    const { id } = await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });

    const outcome = await runNext.run();

    expect(outcome).toMatchObject({ kind: "failed", reason: "validation_failed" });
    expect(restores.rows.get(id)).toMatchObject({ status: "failed", failureReason: "validation_failed" });
    expect(restores.rows.get(id)?.report).not.toBeNull();
    expect(dropped).toEqual([restores.rows.get(id)?.databaseName]);
  });

  it("drops the database when psql stops, and says why", async () => {
    const { request, runNext, restores, dropped, audit } = setup({ restoreError: new DumpRestoreError("dump_corrupt") });
    const { id } = await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });

    await runNext.run();

    expect(restores.rows.get(id)).toMatchObject({ status: "failed", failureReason: "dump_corrupt" });
    expect(dropped).toHaveLength(1);
    expect(audit.at(-1)).toMatchObject({ action: "backup_restore.failed", metadata: { reason: "dump_corrupt" } });
  });

  it("closes a restore a dead machine left running, then frees the slot", async () => {
    const { request, runNext, restores, dropped } = setup();
    const { id } = await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });
    const claimed = await restores.claimNext();
    restores.stale = [claimed!];

    const outcome = await runNext.run();

    expect(outcome.kind).toBe("idle");
    expect(restores.rows.get(id)).toMatchObject({ status: "failed", failureReason: "interrupted" });
    expect(dropped).toEqual([claimed!.databaseName]);
  });
});

describe("DiscardBackupRestoreUseCase", () => {
  it("drops a passed restore's database, and only a passed one", async () => {
    const { request, runNext, discard, restores, dropped } = setup();
    const { id } = await request.run({ ...OWNER, backupKey: KEY, confirmation: KEY });
    await expect(discard.run({ ...OWNER, restoreId: id })).rejects.toBeInstanceOf(BackupRestoreNotDiscardableError);
    await runNext.run();

    await discard.run({ ...OWNER, restoreId: id });

    expect(restores.rows.get(id)?.status).toBe("discarded");
    expect(dropped).toEqual([restores.rows.get(id)?.databaseName]);
  });
});

async function filtered(input: string, chunkSize = 7): Promise<string> {
  const chunks: Buffer[] = [];
  const bytes = Buffer.from(input, "utf8");
  const parts: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) parts.push(bytes.subarray(i, i + chunkSize));
  await pipeline(
    Readable.from(parts),
    createDumpFilter(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
  );
  return Buffer.concat(chunks).toString("utf8");
}

describe("createDumpFilter", () => {
  it("drops ownership and grants, and leaves COPY rows alone", async () => {
    const dump = [
      "CREATE TABLE public.students (id uuid, note text);",
      "ALTER TABLE public.students OWNER TO neondb_owner;",
      "GRANT SELECT ON TABLE public.students TO ooc_app;",
      "ALTER DEFAULT PRIVILEGES FOR ROLE x GRANT ALL ON TABLES TO ooc_app;",
      "COPY public.students (id, note) FROM stdin;",
      "GRANT SELECT\tLíneas con ñ y acentos",
      "\\.",
      "REVOKE DELETE ON public.students FROM ooc_app;",
      "SELECT 1;",
    ].join("\n");

    expect(await filtered(`${dump}\n`)).toBe(
      [
        "CREATE TABLE public.students (id uuid, note text);",
        "COPY public.students (id, note) FROM stdin;",
        "GRANT SELECT\tLíneas con ñ y acentos",
        "\\.",
        "SELECT 1;",
        "",
      ].join("\n"),
    );
  });
});

describe("libpqEnv", () => {
  it("moves the connection off the command line, password decoded", () => {
    expect(
      libpqEnv("postgresql://owner:p%40ss@ep-x.sa-east-1.aws.neon.tech/ooc_restore_1?sslmode=require&channel_binding=require"),
    ).toEqual({
      PGHOST: "ep-x.sa-east-1.aws.neon.tech",
      PGPORT: "5432",
      PGUSER: "owner",
      PGPASSWORD: "p@ss",
      PGDATABASE: "ooc_restore_1",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
    });
  });
});
