export const BACKUP_RESTORE_QUEUE = "backup-restore";

/**
 * How often the worker looks for a queued restore (OOC-153). A restore is an
 * owner's click on a rare day; fifteen seconds is "right away" and costs one
 * indexed read when there is nothing to do. The row in `backup_restores` is
 * the job — Redis carries no payload.
 */
export const BACKUP_RESTORE_EVERY_MS = 15_000;
