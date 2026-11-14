import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { NationalIdTypeSchema, nationalIdIssue, normalizeEmail, normalizeNationalId, type NationalIdType } from "../../student/fields.js";

/** The copy of both e-mails names these durations — keep them in step
 * (packages/notifications/src/locales). */
export const PORTAL_ACTIVATION_TTL_DAYS = 7;
export const PORTAL_RESET_TTL_MINUTES = 60;
/** At most one e-mail per account in this window, however often it is asked for. */
export const PORTAL_TOKEN_COOLDOWN_SECONDS = 60;
/**
 * What sign-in is handed when the identifier matches no student account: an
 * address that cannot exist, so Better Auth still hashes the password and
 * answers the same error in the same time (anti-enumeration, CLAUDE.md §8).
 */
export const PORTAL_SIGN_IN_SENTINEL_EMAIL = "no-account@invalid.local";

export type PortalAccessTokenPurpose = "activation" | "reset";
export type PortalAccessOutcome = "created" | "linked_existing" | "already_linked" | "email_conflict";
export type PortalAccessState = "none" | "pending_activation" | "active";

/** The two doors to the same account (CLAUDE.md §1): the e-mail the
 * credentials went to, or the document the student enrolled with. Always
 * normalized — built only by `parsePortalIdentifier`. */
export type PortalIdentifier =
  | { method: "email"; email: string }
  | { method: "national_id"; nationalIdType: NationalIdType; nationalId: string };

export interface PortalAccount {
  userId: string;
  email: string;
  name: string;
  hasPassword: boolean;
}

/** One person the account reaches (OOC-147): the student themself, or each
 * child of a guardian. `id` is the person's newest file. */
export interface PortalProfile {
  id: string;
  firstName: string;
  lastName: string;
}

/** The profile the portal is showing, and every profile the account has —
 * more than one only for a guardian with several children. */
export interface PortalIdentity {
  firstName: string;
  lastName: string;
  email: string;
  profileId: string;
  profiles: PortalProfile[];
}

export interface PortalAccessToken {
  id: string;
  userId: string;
  purpose: PortalAccessTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
}

/** `token` travels only in the link; `tokenHash` is what is stored. */
export interface NewPortalToken {
  token: string;
  tokenHash: string;
  purpose: PortalAccessTokenPurpose;
  expiresAt: Date;
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPortalToken(purpose: PortalAccessTokenPurpose, now: Date = new Date()): NewPortalToken {
  const token = randomBytes(32).toString("base64url");
  const ttlMs = purpose === "activation" ? PORTAL_ACTIVATION_TTL_DAYS * 86_400_000 : PORTAL_RESET_TTL_MINUTES * 60_000;
  return { token, tokenHash: hashPortalToken(token), purpose, expiresAt: new Date(now.getTime() + ttlMs) };
}

const RawIdentifierSchema = z.object({
  method: z.enum(["email", "national_id"]),
  identifier: z.string().max(254),
  nationalIdType: z.string().optional(),
});
const EmailFormat = z.string().min(1).email();

/**
 * Anything that is not a well-formed identifier is `null` — and the caller
 * answers it exactly like a wrong password: the screen never learns which
 * field was off.
 */
export function parsePortalIdentifier(raw: unknown): PortalIdentifier | null {
  const parsed = RawIdentifierSchema.safeParse(raw);
  if (!parsed.success) return null;

  if (parsed.data.method === "email") {
    const email = normalizeEmail(parsed.data.identifier);
    return EmailFormat.safeParse(email).success ? { method: "email", email } : null;
  }

  const type = NationalIdTypeSchema.safeParse(parsed.data.nationalIdType);
  if (!type.success) return null;
  const nationalId = normalizeNationalId(parsed.data.identifier);
  if (nationalId.length === 0 || nationalIdIssue(type.data, nationalId) !== null) return null;
  return { method: "national_id", nationalIdType: type.data, nationalId };
}
