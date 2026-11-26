import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class ComplaintNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "complaint.not_found", message: "The complaints book sheet does not exist.", ...params });
  }
}

/** Somebody already took the sheet (OOC-58): it is theirs to answer now. */
export class ComplaintAlreadyTakenError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "complaint.already_taken", message: "The sheet was already taken.", ...params });
  }
}

/** A sheet is answered once; the answer went to the consumer and never changes. */
export class ComplaintAlreadyAnsweredError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "complaint.already_answered", message: "The sheet was already answered.", ...params });
  }
}

export class ComplaintAnswerRequiredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "complaint.answer_required",
      message: "An answer needs 1 to 5000 characters.",
      ...params,
    });
  }
}
