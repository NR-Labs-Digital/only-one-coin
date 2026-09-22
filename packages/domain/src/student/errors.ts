import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class GuardianRequiredForMinorError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "student.guardian_required_for_minor",
      message: "A guardian is required when the student is a minor.",
      ...params,
    });
  }
}

/**
 * Somebody is already on file under this document.
 *
 * Manual registration refuses instead of reusing the record, and the
 * difference is deliberate: the public checkout knows who is typing (the
 * person themselves, enrolling), so it can carry them back to their own
 * record. A staff member filling the registration form is asserting that a new
 * person exists, and when that is wrong the honest answer is to say so — the
 * alternative is a create form quietly rewriting a stranger's contact details
 * because two people share a mistyped DNI.
 *
 * The enrollment they were opening is not blocked by this: the manual
 * enrollment form searches the directory and finds the record that already
 * exists (CLAUDE.md §1, "só sobre aluno já cadastrado").
 */
export class StudentAlreadyRegisteredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "student.already_registered",
      message: "A student is already registered under this national id.",
      ...params,
    });
  }
}
