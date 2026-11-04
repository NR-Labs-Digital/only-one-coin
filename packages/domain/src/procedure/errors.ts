import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class ProcedureRequestNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.request_not_found", message: "The procedure request does not exist.", ...params });
  }
}

/** Same answer for an enrollment of someone else, a retired one and one whose
 * seat is not confirmed: an id from the client reveals nothing (CLAUDE.md §8). */
export class ProcedureEnrollmentNotEligibleError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.enrollment_not_eligible", message: "The enrollment cannot request this procedure.", ...params });
  }
}

export class ProcedureAlreadyOpenError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.already_open", message: "This procedure was already requested for the enrollment.", ...params });
  }
}

export class ProcedureNotPayableError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.not_payable", message: "The procedure request no longer takes a payment.", ...params });
  }
}

export class ProcedurePriceNotSetError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.price_not_set", message: "The procedure has no price in force.", ...params });
  }
}

export class InvalidProcedurePriceError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "procedure.invalid_price", message: "The price is outside the allowed range.", ...params });
  }
}
