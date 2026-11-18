import { normalizeEmail } from "./fields.js";
import { Student } from "./Student.js";

/**
 * The version of the consent text in force (Ley 29733, CLAUDE.md §8). The
 * checkout stamps it on the box the guardian ticks, the public catalog sends
 * it to the screen that prints it, and the portal stamps it when a guardian
 * accepts there (OOC-72) — one constant, so the three never drift apart. The
 * text itself is UI copy (`checkout.student.consent_label`, three locales).
 */
export const CURRENT_CONSENT_VERSION = "v1";

/**
 * Where a student file stands on the guardian's consent (OOC-72):
 *
 * - `not_required` — the student is of age: consent is a minor's matter, the
 *   same as in the checkout, which records it only with a guardian.
 * - `accepted` — the live guardian has at least one consent on record.
 * - `pending` — a minor whose live guardian has none (or no guardian at all,
 *   which the student file flags on its own).
 *
 * Read with today's age: a file that comes of age stops being pending without
 * any write, and a consent once given stays given.
 */
export type GuardianConsentState = "accepted" | "pending" | "not_required";

export function guardianConsentStateOf(file: { birthDate: Date; consentGiven: boolean }): GuardianConsentState {
  if (!Student.isMinorBornOn(file.birthDate)) return "not_required";
  return file.consentGiven ? "accepted" : "pending";
}

/**
 * Whether a portal account is the guardian of a file (OOC-72): the account's
 * e-mail is the live guardian's, compared the way the guardian's door is
 * (`reachableStudentIdsSql`, OOC-147). That is who may accept — never the
 * student's own account, unless the guardian gave that same address.
 */
export function isGuardianAccount(guardianEmail: string | null, accountEmail: string): boolean {
  if (!guardianEmail) return false;
  return normalizeEmail(guardianEmail) === normalizeEmail(accountEmail);
}
