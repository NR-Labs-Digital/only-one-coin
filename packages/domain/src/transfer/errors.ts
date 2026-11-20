import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export type EnrollmentTransferRefusal =
  /** The seat is not confirmed — reserved (still waiting for money), released, or frozen. */
  | "seat_not_confirmed"
  /** The course does not offer the traspaso (`courses.allows_enrollment_transfer`). */
  | "course_disallows"
  /** The class group is neither enrolling nor in progress: nothing left to hand over. */
  | "class_group_not_running"
  /** A grade (or DA) is on the enrollment: it is the person's, not the seat's. */
  | "graded"
  /** A paid procedure (the constancia) is open on the enrollment, in the current holder's name. */
  | "procedure_open"
  /** The destination is the person who holds the enrollment now. */
  | "same_student"
  /** The destination already has a live enrollment in the course: one person, one seat per course. */
  | "student_already_enrolled"
  /** The destination is younger than the course's minimum age. */
  | "student_below_minimum_age"
  /** The destination is a minor with no guardian on file. */
  | "guardian_required"
  | "reason_required";

export class EnrollmentTransferRefusedError extends UnableToProcessEntryError {
  constructor(refusal: EnrollmentTransferRefusal, params?: { path?: string; cause?: unknown }) {
    super({
      reason: `enrollment.transfer_${refusal}`,
      message: `The enrollment cannot be transferred: ${refusal}.`,
      ...params,
    });
  }
}

/** The destination student does not exist or was retired. */
export class EnrollmentTransferStudentNotFoundError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.transfer_student_not_found",
      message: "The student to transfer the enrollment to was not found.",
      ...params,
    });
  }
}

/** The enrollment or the destination changed while the transfer ran — read it again. */
export class EnrollmentTransferConflictError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "enrollment.transfer_conflict", message: "The enrollment changed meanwhile.", ...params });
  }
}
