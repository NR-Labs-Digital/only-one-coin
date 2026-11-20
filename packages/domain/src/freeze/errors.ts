import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export type FreezeRefusal =
  /** The seat is not confirmed — reserved, released, or frozen already. */
  | "seat_not_confirmed"
  /** The course does not allow freezing (`courses.allows_freeze`, e.g. intermedio/avanzado). */
  | "course_disallows"
  /** The class group is not selling nor running: there is no module to pause. */
  | "class_group_not_running"
  | "reason_required";

export class EnrollmentFreezeRefusedError extends UnableToProcessEntryError {
  constructor(refusal: FreezeRefusal, params?: { path?: string; cause?: unknown }) {
    super({ reason: `enrollment.freeze_${refusal}`, message: `The enrollment cannot be frozen: ${refusal}.`, ...params });
  }
}

export type FreezeReturnRefusal =
  | "not_frozen"
  /** The run is not of the course, not of the module the student stopped in, or not open. */
  | "target_unavailable";

export class EnrollmentReturnRefusedError extends UnableToProcessEntryError {
  constructor(refusal: FreezeReturnRefusal, params?: { path?: string; cause?: unknown }) {
    super({ reason: `enrollment.return_${refusal}`, message: `The enrollment cannot come back: ${refusal}.`, ...params });
  }
}

/** The enrollment changed while it was being frozen or brought back — read it again. */
export class EnrollmentFreezeConflictError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "enrollment.freeze_conflict", message: "The enrollment changed meanwhile.", ...params });
  }
}
