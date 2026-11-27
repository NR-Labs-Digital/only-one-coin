import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { BACKUP_RESTORE_EVERY_MS, BACKUP_RESTORE_QUEUE } from "../jobs/backup-restore.job.js";

export function createBackupRestoreQueue(connection: ConnectionOptions): Queue {
  return new Queue(BACKUP_RESTORE_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleBackupRestore(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    BACKUP_RESTORE_QUEUE,
    { every: BACKUP_RESTORE_EVERY_MS },
    { name: BACKUP_RESTORE_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}
