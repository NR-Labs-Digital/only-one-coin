import type { BackupRestoreCapabilities, IRestoreTarget } from "@ooc/domain";
import type { Config } from "@/config.js";
import { createS3Client } from "@/infra/storage/s3Client.js";
import { LocalPostgresRestoreTarget } from "./LocalPostgresRestoreTarget.js";
import { NeonRestoreTarget } from "./NeonRestoreTarget.js";
import { PsqlDumpRestorer } from "./PsqlDumpRestorer.js";
import { TigrisBackupStore } from "./TigrisBackupStore.js";

/**
 * What this environment can do with backups (OOC-153), from optional config:
 * the bucket to list, and where a restore goes — Neon in production, or the
 * local Postgres (refused in production by the config schema).
 */
export function createBackupRestoreCapabilities(config: Config): BackupRestoreCapabilities {
  const store = config.BACKUP_BUCKET_NAME
    ? new TigrisBackupStore(
        createS3Client({
          ...config,
          AWS_ACCESS_KEY_ID: config.BACKUP_ACCESS_KEY_ID ?? config.AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: config.BACKUP_SECRET_ACCESS_KEY ?? config.AWS_SECRET_ACCESS_KEY,
        }),
        config.BACKUP_BUCKET_NAME,
      )
    : null;

  let target: IRestoreTarget | null = null;
  if (config.NEON_API_KEY && config.NEON_PROJECT_ID && config.NEON_RESTORE_BRANCH_ID && config.NEON_RESTORE_ROLE) {
    target = new NeonRestoreTarget({
      apiKey: config.NEON_API_KEY,
      projectId: config.NEON_PROJECT_ID,
      branchId: config.NEON_RESTORE_BRANCH_ID,
      role: config.NEON_RESTORE_ROLE,
    });
  } else if (config.BACKUP_RESTORE_ADMIN_URL && config.NODE_ENV !== "production") {
    target = new LocalPostgresRestoreTarget(config.BACKUP_RESTORE_ADMIN_URL);
  }

  const restorer = store ? new PsqlDumpRestorer((key) => store.open(key), config.PSQL_PATH) : null;
  return { store, target, restorer };
}
