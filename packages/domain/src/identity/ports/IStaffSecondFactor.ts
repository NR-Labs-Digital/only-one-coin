import type { Locale } from "../../notification/EmailNotification.js";

export interface StaffMfaState {
  enabled: boolean;
  /** Unused recovery codes left — what stands between a dead inbox and a lockout. */
  recoveryCodesLeft: number;
}

export type MfaCodeFailure =
  | "staff_mfa.code_invalid"
  | "staff_mfa.code_expired"
  | "staff_mfa.code_attempts_exhausted";

export type ConfirmMfaEnrollmentResult =
  | {
      ok: true;
      /**
       * Turning the factor on replaces the session it was done from. These are
       * the `Set-Cookie` values the client must receive to keep being signed
       * in — opaque here, only the HTTP layer hands them on.
       */
      sessionCookies: string[];
    }
  | { ok: false; reason: MfaCodeFailure };

/**
 * The staff second factor (OOC-29) — an e-mailed code, kept by Better Auth's
 * `twoFactor` plugin in its own tables, so the adapter lives in apps/api.
 * Codes are bound to the session that asked for them: the session token is
 * how the adapter finds which one, never an id from the client (CLAUDE.md §8).
 */
export interface IStaffSecondFactor {
  state(userId: string): Promise<StaffMfaState>;
  /** E-mails a fresh code to the account's own address, in the given locale. */
  sendEnrollmentCode(sessionToken: string, locale: Locale): Promise<void>;
  /** Checks the code sent to this session and, when it matches, turns the factor on. */
  confirmEnrollment(sessionToken: string, code: string): Promise<ConfirmMfaEnrollmentResult>;
  /** Replaces every recovery code with a new set and returns it — the only time anyone sees them. */
  replaceRecoveryCodes(userId: string): Promise<string[]>;
  /** Turns the factor off and drops its recovery codes. */
  disable(userId: string): Promise<void>;
}
