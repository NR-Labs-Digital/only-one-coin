import type { ComplaintForm } from "../student/fields.js";
import type { Locale } from "../notification/EmailNotification.js";

/**
 * Which privacy notice the consumer accepted on the complaints book form
 * (Ley 29733, CLAUDE.md §8: the version, the date and the IP of whoever
 * accepts). Bump it in the same PR that changes the notice's wording.
 */
export const COMPLAINT_PRIVACY_NOTICE_VERSION = "2026-11-24";

/** Who answered for the site when the sheet was filed — frozen on the sheet. */
export interface ComplaintSupplier {
  legalName: string;
  ruc: string;
  address: string;
}

/** A sheet as it is written: what the consumer sent, plus what the server stamps. */
export interface NewComplaint {
  form: ComplaintForm;
  supplier: ComplaintSupplier;
  locale: Locale;
  privacyNoticeVersion: string;
  /** The consumer's IP, resolved by the API — never taken from the body. */
  ip: string;
  /** Minted by the form once per sheet; a resend of the same sheet files nothing new. */
  idempotencyKey: string;
}

/** The sheet once in the book. */
export interface FiledComplaint {
  id: string;
  /** The correlative number shown to the consumer (`2026-000123`). */
  code: string;
  filedAt: Date;
}

/**
 * The correlative number of a sheet: the year it was filed in Lima and the
 * book's sequence, at least six digits. The sequence never restarts, so the
 * number alone is unique; the year is there for the person reading it.
 */
export function complaintCodeOf(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(6, "0")}`;
}
