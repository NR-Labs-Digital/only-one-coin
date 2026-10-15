import type { EmailNotification, Locale } from "../notification/EmailNotification.js";

/** The code e-mail names this duration — keep them in step
 * (packages/notifications/src/locales, `staff_mfa_code`, and the
 * `otpOptions.period` of the `twoFactor` plugin in apps/api). */
export const STAFF_MFA_CODE_TTL_MINUTES = 10;

/**
 * The second-factor code, only ever to the account's own login address.
 * `sendId` makes every send its own outbox row: a second request for a code
 * is a new code, never a no-op on the first one's dedupe key.
 */
export function staffMfaCodeEmail(params: {
  userId: string;
  sendId: string;
  to: string;
  recipientName: string;
  code: string;
  locale: Locale;
}): EmailNotification {
  return {
    templateKey: "staff_mfa_code",
    to: params.to,
    locale: params.locale,
    vars: { recipientName: params.recipientName, code: params.code },
    dedupeKey: `staff_mfa_code:${params.userId}:${params.sendId}`,
  };
}
