import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class CatalogEntryNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.entry_not_found",
      message: "No catalog entry of that kind with that id.",
      ...params,
    });
  }
}

export class CourseNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.course_not_found", message: "No live course with that id.", ...params });
  }
}

export class PlanNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.plan_not_found", message: "No live plan with that id.", ...params });
  }
}

export class PriceInPastError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.price_in_past", message: "A price cannot start in the past.", ...params });
  }
}

export class PeriodNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.period_not_found", message: "No live academic period with that id.", ...params });
  }
}

export class CatalogClassGroupNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_not_found", message: "No live class group with that id.", ...params });
  }
}

export class InvalidDateRangeError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.invalid_date_range", message: "A range must start before it ends.", ...params });
  }
}

export class InvalidStatusTransitionError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.invalid_status_transition", message: "A class group moves forward one step at a time.", ...params });
  }
}

export class ClassGroupIncompleteError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_incomplete", message: "Only a draft may lack start and end dates.", ...params });
  }
}

export class CapacityBelowSeatsTakenError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.capacity_below_seats_taken", message: "Capacity cannot drop below the seats already taken.", ...params });
  }
}

export class ClassGroupCourseLockedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_course_locked", message: "The course only changes on an empty draft.", ...params });
  }
}

/** No teacher on the roster with that id — never filed, or left it (OOC-80). */
export class ClassGroupTeacherUnavailableError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_teacher_unavailable", message: "Only an active teacher runs a class group.", ...params });
  }
}

export class ClassGroupTeacherLanguageError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_teacher_language", message: "The teacher does not teach the course's language.", ...params });
  }
}

export class PeriodAlreadyDuplicatedError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.period_already_duplicated", message: "That period was already copied into this one.", ...params });
  }
}

export class DuplicateSamePeriodError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.duplicate_same_period", message: "Source and target periods must differ.", ...params });
  }
}

export class ClassGroupNotFullError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.class_group_not_full", message: "Only a full class group has a waitlist.", ...params });
  }
}

export class WaitlistAlreadyJoinedError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.waitlist_already_joined", message: "That student is already waiting for that class group.", ...params });
  }
}

export class WaitlistAlreadyEnrolledError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.waitlist_already_enrolled", message: "That student already holds a seat in that class group.", ...params });
  }
}

export class WaitlistStudentNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.waitlist_student_not_found", message: "No live student with that id.", ...params });
  }
}

export class WaitlistEntryClosedError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.waitlist_entry_closed", message: "That place in the waitlist was already closed.", ...params });
  }
}

export class WaitlistEntryNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.waitlist_entry_not_found", message: "No waitlist entry with that id.", ...params });
  }
}

/**
 * Another live course already answers to that landing key (OOC-117). Two
 * courses behind one enroll button would leave the checkout to guess.
 */
export class LandingKeyTakenError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.landing_key_taken",
      message: "Another live course is already linked to that landing page.",
      ...params,
    });
  }
}

/** A course carries one material link per module (OOC-94) — not one fewer, not one more. */
export class ModuleMaterialsIncompleteError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.module_materials_incomplete",
      message: "Every module needs exactly one material link.",
      ...params,
    });
  }
}

/** A material link ends up as an href on a teacher's screen: https on Google Drive or Docs, nothing else. */
export class ModuleMaterialInvalidError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.module_material_invalid",
      message: "A module material must be an https link on Google Drive or Docs.",
      ...params,
    });
  }
}

export class ClassroomUrlInvalidError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.classroom_url_invalid",
      message: "A class group's Classroom link must be an https link on classroom.google.com.",
      ...params,
    });
  }
}

/** A class group teaches one of its course's modules (OOC-100): 1 up to the course's module count. */
export class ClassGroupModuleOutOfRangeError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "catalog.class_group_module_out_of_range",
      message: "The class group's module must be one of its course's modules.",
      ...params,
    });
  }
}

export class LanguageNotFoundError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.language_not_found", message: "No live language with that id or name.", ...params });
  }
}

export class LanguageExistsError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.language_exists", message: "A live language already has that name.", ...params });
  }
}

export class LanguageInUseError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "catalog.language_in_use", message: "Live courses are still filed under this language.", ...params });
  }
}
