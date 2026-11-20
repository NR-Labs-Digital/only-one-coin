import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

/** Same answer for an enrollment of someone else, a package one, a retired one
 * and one whose seat is not confirmed: an id from the client reveals nothing
 * (CLAUDE.md §8). */
export class MonthlyEnrollmentNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "monthly.enrollment_not_found", message: "The monthly enrollment does not exist.", ...params });
  }
}

/** The selection is not a prefix of what is for sale now — someone paid meanwhile, or the count is off. */
export class MonthlyModulesNotForSaleError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "monthly.modules_not_for_sale", message: "Those modules cannot be bought now.", ...params });
  }
}

/** The plan has no price in force, or the student is in a run with no module number. */
export class MonthlyNotPayableError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "monthly.not_payable", message: "The enrollment cannot buy modules now.", ...params });
  }
}
