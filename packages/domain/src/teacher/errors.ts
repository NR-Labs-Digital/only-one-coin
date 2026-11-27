import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { HttpError } from "../shared/base/errors/HttpError.js";
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

/** No live shared Classroom account with that id (OOC-196). */
export class ClassroomAccountNotFoundError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "classroom_account.not_found", message: "No live Classroom account with that id.", ...params });
  }
}

/** A live Classroom account already has this e-mail, ignoring case (OOC-196). */
export class ClassroomAccountExistsError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "classroom_account.exists", message: "A live Classroom account already has this e-mail.", ...params });
  }
}

/**
 * The account already has as many teachers as `classroom_account_max_teachers`
 * allows at a time (OOC-196, 7 today).
 */
export class ClassroomAccountFullError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "classroom_account.full", message: "This Classroom account has no free place.", ...params });
  }
}

/** Retiring an account that teachers still use: they move to another one first. */
export class ClassroomAccountInUseError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "classroom_account.in_use", message: "Teachers still use this Classroom account.", ...params });
  }
}

/** A teacher off the roster gets no Classroom account — leaving clears it. */
export class ClassroomAccountTeacherInactiveError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "classroom_account.teacher_inactive",
      message: "A teacher off the roster cannot be given a Classroom account.",
      ...params,
    });
  }
}

/**
 * A sealed Classroom password could not be opened — the key it was sealed
 * with is gone (BETTER_AUTH_SECRET rotated) or the value is damaged. Closed,
 * never open: nothing is shown, and coordination types the password again.
 */
export class ClassroomCredentialsUnavailableError extends HttpError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      status: 503,
      reason: "classroom_account.credentials_unavailable",
      message: "The sealed Classroom password cannot be opened.",
      ...params,
    });
  }
}
