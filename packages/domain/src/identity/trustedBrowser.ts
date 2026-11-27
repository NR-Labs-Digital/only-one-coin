/**
 * How long "remember this browser" skips the e-mailed code (OOC-154). Counted
 * from the day the code was typed with the box ticked — signing in again does
 * not push it forward (apps/api, `TrustedBrowserGate`). Security parameter of
 * the sign-in, not a school rule: it lives here, like
 * `STAFF_MFA_CODE_TTL_MINUTES`, and the login copy names it.
 */
export const TRUSTED_BROWSER_DAYS = 30;
