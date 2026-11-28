/*
 * Restoring a production backup into a scratch database (OOC-153).
 *
 * The backup is the `pg_dump` the API deploy writes to the backups bucket
 * before every migration (`.github/workflows/deploy-api.yml`). Restoring one
 * here never touches the database the platform runs on: the worker creates a
 * new, empty database, loads the dump into it in one transaction, and then
 * checks what came back. Only a restore whose every check passes is kept; any
 * failure drops the scratch database and production carries on exactly as it
 * was. Pointing production at a restored database stays a manual step
 * (docs/RESTAURAR-BACKUP.md, "Restaurar de verdade").
 */

/** `ooc-prod-YYYYMMDDTHHMMSSZ.sql.gz`, the only names the deploy writes. */
export const BACKUP_KEY_PATTERN = /^ooc-prod-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sql\.gz$/;

export function isBackupKey(key: string): boolean {
  return BACKUP_KEY_PATTERN.test(key);
}

/** When the backup was taken — read off its name, which carries the UTC instant. */
export function backupTakenAt(key: string): Date | null {
  const match = BACKUP_KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

export interface BackupFile {
  key: string;
  takenAt: Date;
  sizeBytes: number;
}

export const BACKUP_RESTORE_STATUSES = ["queued", "restoring", "validating", "passed", "failed", "discarded"] as const;
export type BackupRestoreStatus = (typeof BACKUP_RESTORE_STATUSES)[number];

/** Still holding the one slot (the partial unique index in `0083`). */
export const OPEN_BACKUP_RESTORE_STATUSES = ["queued", "restoring", "validating", "passed"] as const;

/**
 * Why a restore failed — a closed vocabulary the screen translates; never the
 * text psql wrote, which can echo a row's content.
 */
export const BACKUP_RESTORE_FAILURES = [
  /** The object is gone from the bucket (retention is 30 days). */
  "backup_not_found",
  /** The scratch database could not be created. */
  "target_unavailable",
  /** The file is not a valid gzip, or ended early. */
  "dump_corrupt",
  /** psql stopped on an error; the transaction rolled everything back. */
  "restore_failed",
  /** Restored, but at least one check below failed. */
  "validation_failed",
  /** The machine running it went away (deploy, crash) mid-restore. */
  "interrupted",
  /** Took longer than the worker allows. */
  "timed_out",
  "unexpected_error",
] as const;
export type BackupRestoreFailure = (typeof BACKUP_RESTORE_FAILURES)[number];

/** The tables the checks read — the same list the OOC-50 script prints. */
export const BACKUP_CORE_TABLES = [
  "students",
  "guardians",
  "enrollments",
  "payments",
  "class_groups",
  "courses",
  "teachers",
  "grades",
  "audit_log",
] as const;
export type BackupCoreTable = (typeof BACKUP_CORE_TABLES)[number];

/**
 * Tables production never loses a row from (the delete lock of `0011`), so a
 * backup of production can never hold more of them than production does now.
 * More means the file is not a backup of this production.
 */
export const BACKUP_NEVER_SHRINKING_TABLES = ["students", "payments", "audit_log"] as const;

/** A production database always has these; an empty one is not a backup of it. */
export const BACKUP_NEVER_EMPTY_TABLES = ["students", "courses", "audit_log"] as const;

/** What the worker reads off the restored database. */
export interface RestoredDatabaseInspection {
  /** Rows per core table; `null` when the table is not there. */
  rowCounts: Record<BackupCoreTable, number | null>;
  /** `created_at` of every row in `drizzle.__drizzle_migrations`, in order. */
  migrationStamps: number[];
  /** An UPDATE on `audit_log` was refused, as the `0011` trigger demands. */
  appendOnlyLockHolds: boolean;
}

export const BACKUP_RESTORE_CHECKS = [
  "tables_present",
  "tables_not_empty",
  "not_ahead_of_production",
  "migrations_match_repository",
  "append_only_lock",
] as const;
export type BackupRestoreCheckKey = (typeof BACKUP_RESTORE_CHECKS)[number];

export interface BackupRestoreCheck {
  check: BackupRestoreCheckKey;
  passed: boolean;
  /** The tables that failed it, when the check is per table. */
  tables?: string[];
}

/** What the screen shows of a finished restore. Numbers and names only. */
export interface BackupRestoreReport {
  rowCounts: Record<string, number | null>;
  productionCounts: Record<string, number>;
  migrationsInBackup: number;
  migrationsInRepository: number;
  checks: BackupRestoreCheck[];
  durationSeconds: number;
}

/**
 * Every check a restored backup has to pass to be kept. Pure: the worker
 * gathers the numbers, this decides.
 *
 * - every core table exists;
 * - the tables production always has rows in are not empty;
 * - no never-shrinking table holds more rows than production holds now;
 * - the backup has migrations, no more than the repository, and its newest
 *   one is in the repository's journal — the backup runs before the deploy's
 *   migration, so it may be behind, but never ahead or off this history.
 *   Only the newest is matched, not every one: a journal entry's `when` was
 *   edited after being applied once (`0045`), and a database migrated before
 *   that keeps the old stamp forever;
 * - the append-only trigger came back with the data.
 */
export function checkRestoredBackup(input: {
  inspection: RestoredDatabaseInspection;
  productionCounts: Record<string, number>;
  repositoryMigrationStamps: number[];
}): BackupRestoreCheck[] {
  const { inspection, productionCounts, repositoryMigrationStamps } = input;
  const counts = inspection.rowCounts;

  const missing = BACKUP_CORE_TABLES.filter((table) => counts[table] === null);
  const empty = BACKUP_NEVER_EMPTY_TABLES.filter((table) => (counts[table] ?? 0) === 0);
  const ahead = BACKUP_NEVER_SHRINKING_TABLES.filter((table) => {
    const restored = counts[table];
    const production = productionCounts[table];
    return restored === null || production === undefined || restored > production;
  });

  const stamps = inspection.migrationStamps;
  const newest = stamps.length > 0 ? Math.max(...stamps) : null;
  const migrationsMatch =
    newest !== null &&
    stamps.length <= repositoryMigrationStamps.length &&
    repositoryMigrationStamps.includes(newest);

  return [
    { check: "tables_present", passed: missing.length === 0, ...(missing.length ? { tables: [...missing] } : {}) },
    { check: "tables_not_empty", passed: empty.length === 0, ...(empty.length ? { tables: [...empty] } : {}) },
    { check: "not_ahead_of_production", passed: ahead.length === 0, ...(ahead.length ? { tables: [...ahead] } : {}) },
    { check: "migrations_match_repository", passed: migrationsMatch },
    { check: "append_only_lock", passed: inspection.appendOnlyLockHolds },
  ];
}

export interface BackupRestoreView {
  id: string;
  backupKey: string;
  databaseName: string;
  status: BackupRestoreStatus;
  failureReason: BackupRestoreFailure | null;
  report: BackupRestoreReport | null;
  requestedBy: string;
  requestedByName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  discardedAt: Date | null;
  discardedByName: string | null;
}

/** The scratch database's name — derived from the row, so two never collide. */
export function restoreDatabaseName(restoreId: string): string {
  return `ooc_restore_${restoreId.replace(/-/g, "").slice(-12)}`;
}
