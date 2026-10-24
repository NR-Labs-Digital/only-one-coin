import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

/**
 * Somebody is already on the roster under this document. A teacher is one
 * person with one file — the unique index `teachers_national_id_uidx` is the
 * guarantee, this is the readable answer (OOC-77).
 */
export class TeacherAlreadyRegisteredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "teacher.already_registered",
      message: "A teacher is already registered under this national id.",
      ...params,
    });
  }
}

export class TeacherNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "teacher.not_found", message: "No live teacher with that id.", ...params });
  }
}

/** Filing named an upload that never reached the bucket (or was already refused). */
export class TeacherContractUploadMissingError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "teacher_contract.upload_missing",
      message: "No uploaded file under that contract upload id.",
      ...params,
    });
  }
}

/** The uploaded bytes are not a PDF, or are empty or too large. The object is removed. */
export class TeacherContractInvalidFileError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "teacher_contract.invalid_file",
      message: "The uploaded contract is not a PDF within the size limit.",
      ...params,
    });
  }
}

/** The same upload filed twice — the unique index on `object_key` is the guarantee. */
export class TeacherContractAlreadyFiledError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "teacher_contract.already_filed",
      message: "That upload is already filed as a contract.",
      ...params,
    });
  }
}

export class TeacherContractNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "teacher_contract.not_found", message: "No contract with that id on this teacher.", ...params });
  }
}
