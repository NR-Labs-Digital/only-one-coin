import { ConflictError } from "../../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";

/** The course picked cannot host a demo class group: retired, no package plan with a price, or no period started. */
export class DemoCourseUnavailableError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "demo_access.course_unavailable",
      message: "The course needs to be live, with a one-off plan priced, and a period already started.",
      ...params,
    });
  }
}

/** The address already belongs to an account, an open invite or a file. */
export class DemoEmailInUseError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "demo_access.email_in_use",
      message: "That e-mail is already in use on the platform.",
      ...params,
    });
  }
}

/** A student's demo account follows the student rule: a personal Gmail (CLAUDE.md §1). */
export class DemoStudentEmailNotGmailError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "demo_access.student_email_not_gmail",
      message: "A student's demo account needs a personal Gmail address.",
      ...params,
    });
  }
}

export class DemoAccessNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "demo_access.not_found", message: "No open demo access with this id.", ...params });
  }
}
