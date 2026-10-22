import { HttpError } from "../shared/base/errors/HttpError.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class ClassGroupFullError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.class_group_full",
      message: "The class group has no seats left.",
      ...params,
    });
  }
}

export class PlanPriceNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.plan_price_not_found",
      message: "The plan has no price on file.",
      ...params,
    });
  }
}

export class ClassGroupNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.class_group_not_found",
      message: "No open class group with that id and plan.",
      ...params,
    });
  }
}

/**
 * The checkout hold is gone — it ran out, was released, or never existed —
 * so the seat it held may already belong to somebody else. The checkout
 * starts again from the class group step (apps/api/CLAUDE.md, "Dois
 * relógios").
 */
export class SeatHoldExpiredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.seat_hold_expired",
      message: "The seat hold expired or does not exist.",
      ...params,
    });
  }
}

export class StudentBelowMinimumAgeError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.student_below_minimum_age",
      message: "The student is younger than the course's minimum age.",
      ...params,
    });
  }
}

/** No receipt upload row with that id, or it belongs to a different seat
 * hold — the two cases are indistinguishable on purpose (anti-IDOR, CLAUDE.md
 * §8): a client fishing for someone else's upload id learns nothing it
 * couldn't already guess. */
export class ReceiptUploadNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.receipt_upload_not_found",
      message: "No receipt upload with that id for this checkout.",
      ...params,
    });
  }
}

/** The confirm arrived before the object actually landed in the bucket — a
 * client that PUT failed silently, or is still mid-upload. Retryable: the
 * checkout tries the confirm again once the browser's upload finishes. */
export class ReceiptNotUploadedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.receipt_not_uploaded",
      message: "The receipt file has not reached storage yet.",
      ...params,
    });
  }
}

/** The submit named a receipt upload that was never confirmed (still
 * `pending`) or failed server-side validation (`rejected`) — the checkout
 * cannot proceed without a receipt that actually made it to storage. */
export class ReceiptNotReadyError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.receipt_not_ready",
      message: "The receipt upload is not confirmed for this checkout.",
      ...params,
    });
  }
}

/** The operation number was already used by another payment of the same
 * method (OOC-22, decision 30/09/2026 — unique per method, compared by
 * `normalizeOperationNumber`). The one hard block of the receipt antifraud:
 * a real operation can only pay for one enrollment, and a resent receipt —
 * cropped or not — still carries the number of the payment it came from. */
export class OperationNumberAlreadyUsedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "enrollment.operation_number_already_used",
      message: "That operation number was already used by another payment.",
      ...params,
    });
  }
}

export class PaymentNotFoundError extends NotFoundError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "payment.not_found", message: "No payment with that id.", ...params });
  }
}

/** Somebody — or the same click twice — already decided this payment. */
export class PaymentAlreadySettledError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "payment.already_settled", message: "The payment was already approved or rejected.", ...params });
  }
}

/** Approving money for a seat that was already handed back would enroll
 * somebody into a place another student may now hold. */
export class PaymentSeatReleasedError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "payment.seat_released", message: "The enrollment's seat was already released.", ...params });
  }
}

/** A re-read needs the payment's latest receipt processed: there is no image
 * for the model to look at otherwise (ROADMAP Sessão 32). */
export class ReceiptNotRereadableError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "payment.receipt_not_rereadable", message: "The payment has no processed receipt to read again.", ...params });
  }
}

/** The receipt is already with the model — a second request would be a
 * second paid call for the same answer. */
export class ReceiptRereadInProgressError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "payment.reread_in_progress", message: "A new reading of this receipt is already on its way.", ...params });
  }
}

/** A code went out for this checkout less than a minute ago. */
export class EmailVerificationCooldownError extends HttpError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ status: 429, reason: "email_verification.cooldown", message: "A code was sent moments ago.", ...params });
  }
}

/** This checkout already spent every code it gets. */
export class EmailVerificationTooManySendsError extends HttpError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      status: 429,
      reason: "email_verification.too_many_sends",
      message: "This checkout already received the maximum number of codes.",
      ...params,
    });
  }
}

/** No code went to this address on this checkout — or the address changed. */
export class EmailVerificationNotFoundError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "email_verification.not_found", message: "No code was sent to this address.", ...params });
  }
}

export class EmailVerificationCodeInvalidError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "email_verification.code_invalid", message: "The code does not match.", ...params });
  }
}

export class EmailVerificationCodeExpiredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({ reason: "email_verification.code_expired", message: "The code expired or was replaced.", ...params });
  }
}

export class EmailVerificationAttemptsExhaustedError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "email_verification.attempts_exhausted",
      message: "Too many wrong codes; a new one is needed.",
      ...params,
    });
  }
}

/** The submit found no verified, unconsumed proof for its seat hold and the
 * student's e-mail (spec 2026-10-07). Nothing was written. */
export class EmailVerificationRequiredError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "email_verification.required",
      message: "The student's e-mail was not verified on this checkout.",
      ...params,
    });
  }
}
