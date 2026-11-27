/**
 * Where a backup is restored: a database created for it and dropped after.
 * Never the database the platform runs on — the adapter only ever creates a
 * new database by name, and the restorer refuses one that is not empty.
 */
export interface IRestoreTarget {
  /** Creates the empty database and returns how to reach it. Never stored. */
  create(databaseName: string): Promise<{ connectionUri: string }>;
  /** How to reach a database `create` made. */
  connectionUri(databaseName: string): Promise<string>;
  /** Drops it. Silent when it is already gone. */
  drop(databaseName: string): Promise<void>;
}
