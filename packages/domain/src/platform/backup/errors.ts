import { ConflictError } from "../../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";

/** The typed confirmation is not the backup's name. */
export class BackupRestoreConfirmationMismatchError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "backup_restore.confirmation_mismatch",
      message: "Type the backup's name exactly to restore it.",
      ...params,
    });
  }
}

/** The key names no backup the deploy writes, or the bucket no longer has it. */
export class BackupNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "backup.not_found", message: "No such backup in the backups bucket.", ...params });
  }
}

/**
 * Another restore is queued or running, or a restored database is still kept:
 * one at a time, because each is a full copy of real student data.
 */
export class BackupRestoreAlreadyOpenError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "backup_restore.already_open",
      message: "Another restore is open. Wait for it, or discard its database first.",
      ...params,
    });
  }
}

export class BackupRestoreNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "backup_restore.not_found", message: "No such restore.", ...params });
  }
}

/** Only a restore that passed still has a database to discard. */
export class BackupRestoreNotDiscardableError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "backup_restore.not_discardable",
      message: "Only a restore that passed still keeps a database to discard.",
      ...params,
    });
  }
}

/** The environment has no backups bucket, or no place to restore into. */
export class BackupRestoreNotConfiguredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "backup_restore.not_configured",
      message: "Backup restore is not configured in this environment.",
      ...params,
    });
  }
}
