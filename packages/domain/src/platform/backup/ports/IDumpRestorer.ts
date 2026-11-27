import type { RestoredDatabaseInspection } from "../BackupRestore.js";

export type DumpRestoreFailure = "backup_not_found" | "dump_corrupt" | "restore_failed" | "timed_out";

/** A restore that stopped, with the reason the screen shows. */
export class DumpRestoreError extends Error {
  constructor(
    readonly reason: DumpRestoreFailure,
    options?: { cause?: unknown },
  ) {
    super(`Dump restore failed: ${reason}`, options);
    this.name = "DumpRestoreError";
  }
}

/** Loads a dump into a database and reads back what the checks need. */
export interface IDumpRestorer {
  /**
   * Streams the backup into the database in one transaction: the first error
   * rolls everything back. Throws `DumpRestoreError`. Refuses a database that
   * already has tables.
   */
  restore(input: { backupKey: string; connectionUri: string }): Promise<void>;
  inspect(connectionUri: string): Promise<RestoredDatabaseInspection>;
}
