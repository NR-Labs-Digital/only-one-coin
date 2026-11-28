import type { BackupRestoreCapabilities, IRestoreTarget } from "@ooc/domain";
import type { Config } from "@/config.js";
import { createS3Client } from "@/infra/storage/s3Client.js";
import { LocalPostgresRestoreTarget } from "./LocalPostgresRestoreTarget.js";
import { PsqlDumpRestorer } from "./PsqlDumpRestorer.js";
import { TigrisBackupStore } from "./TigrisBackupStore.js";

/**
 * What this environment can do with backups (OOC-153), from optional config:
 * the bucket to list, and where a restore goes — only the local Postgres
 * (refused in production by the config schema). Restoring in production is
 * out of scope for now (28/11/2026): it used a database created through the
 * Neon API, and the platform is leaving Neon, so production lists the
 * backups and restores nothing until a provider-neutral target exists.
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

  const target: IRestoreTarget | null =
    config.BACKUP_RESTORE_ADMIN_URL && config.NODE_ENV !== "production"
      ? new LocalPostgresRestoreTarget(config.BACKUP_RESTORE_ADMIN_URL)
      : null;

  const restorer = store ? new PsqlDumpRestorer((key) => store.open(key), config.PSQL_PATH) : null;
  return { store, target, restorer };
}
