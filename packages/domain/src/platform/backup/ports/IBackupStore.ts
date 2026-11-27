import type { BackupFile } from "../BackupRestore.js";

/** The backups bucket — read only. The deploy writes it; nothing here does. */
export interface IBackupStore {
  /** Every `ooc-prod-*.sql.gz`, newest first. */
  list(): Promise<BackupFile[]>;
  exists(key: string): Promise<boolean>;
}
