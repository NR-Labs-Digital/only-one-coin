/**
 * A document the institution issues (OOC-33): the constancia of a paid
 * procedure request and the course certificate. Never a file anybody uploaded
 * (`attachment/`, OOC-143) — this one carries a verification code, which the
 * public validation page (OOC-59) answers for.
 *
 * Append-only, like every record of something handed out: the row keeps the
 * template version and the data the document printed with, so the PDF comes
 * out the same every time it is downloaded, whatever changed on the file since.
 */
export const ISSUED_DOCUMENT_KINDS = ["enrollment_certificate", "certificate"] as const;
export type IssuedDocumentKind = (typeof ISSUED_DOCUMENT_KINDS)[number];

export interface IssuedDocument {
  id: string;
  kind: IssuedDocumentKind;
  code: string;
  studentId: string;
  enrollmentId: string;
  /** The constancia's paid request; null on a certificate. */
  procedureRequestId: string | null;
  /** The certificate's module group (the course's last module); null on a constancia. */
  classGroupModuleId: string | null;
  templateVersionId: string;
  /** The template's variables, frozen on issue. */
  data: unknown;
  /** Null when the platform issued it on its own (the constancia). */
  issuedBy: string | null;
  issuedAt: Date;
  /** The document this one was issued in place of (OOC-59); null on a first issue. */
  replacesId: string | null;
}

/**
 * What the validation page says about a code (OOC-59). Derived, never
 * stored — the document row is append-only:
 *
 * - `replaced`: a later document was issued in its place (a certificate issued
 *   again after this one was revoked). Wins over `revoked`: it says there is a
 *   good one now.
 * - `revoked`: a person withdrew it, and nothing replaced it.
 * - `valid`: neither.
 */
export const ISSUED_DOCUMENT_STATUSES = ["valid", "revoked", "replaced"] as const;
export type IssuedDocumentStatus = (typeof ISSUED_DOCUMENT_STATUSES)[number];

export function issuedDocumentStatus(facts: { revoked: boolean; replaced: boolean }): IssuedDocumentStatus {
  if (facts.replaced) return "replaced";
  if (facts.revoked) return "revoked";
  return "valid";
}

/** A revocation's reason: required, trimmed, at most this long (the CHECK of 0071). */
export const REVOCATION_REASON_MAX_LENGTH = 500;

/**
 * The verification code's alphabet: digits and capitals with nothing two
 * people read alike — no 0/O, 1/I/L. A code is read off paper and typed into
 * the validation page, often on a phone.
 */
export const VERIFICATION_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_GROUPS = 2;
const GROUP_LENGTH = 4;

/**
 * `OOC-7K4M-9QX2`: eight random characters of a 31-letter alphabet (~40 bits),
 * unique in the database (the unique index decides a collision, and the issuer
 * draws again). Random, never a sequence: a sequence would let anyone walk
 * every certificate from the validation page.
 */
export function newDocumentCode(randomBytes: (length: number) => Uint8Array = cryptoRandomBytes): string {
  const bytes = randomBytes(CODE_GROUPS * GROUP_LENGTH);
  const characters = Array.from(bytes, (byte) => VERIFICATION_CODE_ALPHABET[byte % VERIFICATION_CODE_ALPHABET.length]);
  const groups: string[] = [];
  for (let index = 0; index < CODE_GROUPS; index += 1) {
    groups.push(characters.slice(index * GROUP_LENGTH, (index + 1) * GROUP_LENGTH).join(""));
  }
  return `OOC-${groups.join("-")}`;
}

/**
 * A code as somebody typed it, in the stored form — capitals, dashes back in
 * place — or null when it cannot be one. For the validation page (OOC-59).
 */
export function normalizeDocumentCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^OOC/, "");
  if (compact.length !== CODE_GROUPS * GROUP_LENGTH) return null;
  if ([...compact].some((character) => !VERIFICATION_CODE_ALPHABET.includes(character))) return null;
  return `OOC-${compact.slice(0, GROUP_LENGTH)}-${compact.slice(GROUP_LENGTH)}`;
}

function cryptoRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
