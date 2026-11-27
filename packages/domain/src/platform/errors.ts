import { ForbiddenError } from "../shared/base/errors/ForbiddenError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";

/**
 * The switchboard is the owners' own (CLAUDE.md §5): what is on the air is not
 * an operational choice like a fee or a tolerance — it is what the platform
 * admits to existing. The cargo does not decide it; the e-mail domain does
 * (`isOwnerEmail`), which is why a perfectly legitimate `admin` is refused
 * here and nowhere else.
 */
export class NotAPlatformOwnerError extends ForbiddenError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "auth.not_a_platform_owner",
      message: "Only an account on the platform owners' e-mail domain may do this (feature flags, backups).",
      ...params,
    });
  }
}

/** A setting outside the bounds the database itself enforces on it. */
export class InvalidPlatformSettingError extends UnableToProcessEntryError {
  constructor(params?: { path?: string; cause?: unknown }) {
    super({
      reason: "platform.invalid_setting",
      message: "The setting is outside its allowed range.",
      ...params,
    });
  }
}
