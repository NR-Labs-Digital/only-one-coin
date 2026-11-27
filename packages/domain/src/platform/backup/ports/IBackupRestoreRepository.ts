import type {
  BackupRestoreFailure,
  BackupRestoreReport,
  BackupRestoreView,
} from "../BackupRestore.js";

export interface ClaimedBackupRestore {
  id: string;
  backupKey: string;
  databaseName: string;
  requestedBy: string;
}

/**
 * Narrow on purpose: a restore moves through its states by these calls and no
 * other — there is no generic update.
 */
export interface IBackupRestoreRepository {
  /** Inserts a queued restore. False when another one is open (the unique index). */
  createQueued(input: { id: string; backupKey: string; databaseName: string; requestedBy: string }): Promise<boolean>;
  find(id: string): Promise<BackupRestoreView | null>;
  listRecent(limit: number): Promise<BackupRestoreView[]>;
  /** The oldest queued restore, moved to `restoring` atomically — two workers never both get it. */
  claimNext(now: Date): Promise<ClaimedBackupRestore | null>;
  /** Restores still `restoring`/`validating` whose heartbeat stopped before `before`. */
  listStale(before: Date): Promise<ClaimedBackupRestore[]>;
  heartbeat(id: string, now: Date): Promise<void>;
  markValidating(id: string, now: Date): Promise<void>;
  markPassed(id: string, report: BackupRestoreReport, now: Date): Promise<void>;
  /** Only from `restoring`/`validating`: false when the row already moved on. */
  markFailed(id: string, reason: BackupRestoreFailure, report: BackupRestoreReport | null, now: Date): Promise<boolean>;
  /** Only from `passed`: false when it was not. */
  markDiscarded(id: string, actorId: string, now: Date): Promise<boolean>;
  /** Rows in production right now, for the never-shrinking tables. */
  productionCounts(tables: readonly string[]): Promise<Record<string, number>>;
}
