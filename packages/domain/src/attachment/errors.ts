import { ForbiddenError } from "../shared/base/errors/ForbiddenError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

/** Same answer for a file that does not exist, one of someone else and one
 * already removed: an id from the client reveals nothing (CLAUDE.md §8). */
export class AttachmentNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.not_found", message: "The file does not exist.", ...params });
  }
}

export class AttachmentOwnerNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.owner_not_found", message: "The owner of the files does not exist.", ...params });
  }
}

export class AttachmentOwnerForbiddenError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.owner_forbidden", message: "This role does not reach these files.", ...params });
  }
}

export class AttachmentUnsupportedTypeError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.unsupported_type", message: "The file type is not accepted.", ...params });
  }
}

export class AttachmentTooLargeError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.too_large", message: "The file is larger than allowed.", ...params });
  }
}

/** The confirm step found nothing at the key: the upload has not landed. */
export class AttachmentNotUploadedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "attachment.not_uploaded", message: "The file has not reached storage.", ...params });
  }
}
