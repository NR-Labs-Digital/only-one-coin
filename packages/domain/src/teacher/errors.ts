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
