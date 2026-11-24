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

export class TeacherContractNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "teacher_contract.not_found", message: "No contract with that id on this teacher.", ...params });
  }
}

/**
 * The teacher's onboarding (OOC-103) runs once, on a file coordination left
 * pending. A complete file is corrected by coordination, never by the teacher
 * (CLAUDE.md §1, OOC-79).
 */
export class TeacherOnboardingClosedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "teacher.onboarding_closed", message: "This teacher file is already complete.", ...params });
  }
}

/**
 * A contract prints the teacher's document and address; a file still pending
 * onboarding (OOC-103) has neither, so nothing is printed or recorded.
 */
export class TeacherProfileIncompleteError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "teacher_contract.profile_incomplete",
      message: "The teacher has not completed their file yet.",
      ...params,
    });
  }
}
