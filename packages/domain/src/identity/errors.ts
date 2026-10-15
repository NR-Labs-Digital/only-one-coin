import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { ForbiddenError } from "../shared/base/errors/ForbiddenError.js";
import { UnauthorizedError } from "../shared/base/errors/UnauthorizedError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

export class NotFreshlyAuthenticatedError extends UnauthorizedError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "auth.not_freshly_authenticated",
      message: "Action requires a fresh re-authentication of the acting admin.",
      ...params,
    });
  }
}

export class InsufficientPrivilegeError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "auth.insufficient_privilege",
      message: "The acting user's role does not permit this action.",
      ...params,
    });
  }
}

/**
 * "Nadie cambia su propio cargo ni se quita el acceso a sí mismo" (CLAUDE.md
 * §8, backed here rather than left as a UI-only convention). Covers role
 * promotion and access removal/restoration alike.
 */
export class CannotActOnSelfError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "auth.cannot_act_on_self",
      message: "An acting admin cannot perform this action on their own account.",
      ...params,
    });
  }
}

/**
 * The current password typed on the account screen is wrong. 422, not 401:
 * the session is fine — a 401 here would read as "logged out" to the panel.
 */
export class CurrentPasswordIncorrectError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "staff_password.current_incorrect",
      message: "The current password does not match.",
      ...params,
    });
  }
}

/** The new password misses a rule of `StaffPasswordPolicy`, or repeats the current one. */
export class NewPasswordRejectedError extends UnableToProcessEntryError {
  constructor(params: { reason: "staff_password.too_weak" | "staff_password.unchanged"; path?: string; cause?: unknown }) {
    super({
      message: "The new password does not meet the panel's password rules.",
      ...params,
    });
  }
}

/**
 * The account's cargo requires the second factor (CLAUDE.md §8) and it is not
 * turned on yet. Raised by apps/api's authorization hook on every staff route
 * except the ones that let the person enroll; the panel answers it by sending
 * them to the enrollment step instead of the screen they asked for.
 */
export class MfaEnrollmentRequiredError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "auth.mfa_enrollment_required",
      message: "This account's role requires a second factor, which is not enabled yet.",
      ...params,
    });
  }
}

/** Turning the second factor off is refused for a cargo that must keep it. */
export class MfaRequiredForRoleError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "staff_mfa.required_for_role",
      message: "This account's role does not allow turning the second factor off.",
      ...params,
    });
  }
}

/** Enrolling an account whose second factor is already on. */
export class MfaAlreadyEnabledError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "staff_mfa.already_enabled",
      message: "The second factor is already enabled on this account.",
      ...params,
    });
  }
}

/** Acting on recovery codes, or turning off a second factor that is not on. */
export class MfaNotEnabledError extends ConflictError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "staff_mfa.not_enabled",
      message: "The second factor is not enabled on this account.",
      ...params,
    });
  }
}

/**
 * The code typed to finish enrolling did not work. 422, not 401: the session
 * is fine — the code is what was wrong, expired, or tried too many times
 * (the last two mean "ask for a new one").
 */
export class MfaCodeRejectedError extends UnableToProcessEntryError {
  constructor(params: {
    reason: "staff_mfa.code_invalid" | "staff_mfa.code_expired" | "staff_mfa.code_attempts_exhausted";
    path?: string;
    cause?: unknown;
  }) {
    super({
      message: "The second-factor code was not accepted.",
      ...params,
    });
  }
}
