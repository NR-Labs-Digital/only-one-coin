import { normalizeEmail, normalizeNationalId } from "@ooc/domain";
import type { FastifyRequest } from "fastify";

/**
 * One counter a route spends from. Rules sharing a `name` share the counter —
 * that is how every staff route draws on one per-user budget.
 *
 * - `ip`: the caller's IP (infra/edge/clientIp.ts). Counted in `onRequest`,
 *   before the body is parsed or the session is looked up — a burst never
 *   reaches Postgres.
 * - `user`: the authenticated staff account. Counted after authorization.
 * - `key`: anything the route names off the validated request — the
 *   checkout's seat hold is its session (OOC-24, "por sessão"). Counted after
 *   validation; a request without the key skips the rule.
 */
export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
} & (
  | { by: "ip" }
  | { by: "user" }
  | { by: "key"; key: (request: FastifyRequest) => string | null | undefined }
);

const MINUTE = 60;

/**
 * The numbers are provisional — a first guess sized on two facts, to be
 * revised with what production shows (the 429s are logged with the rule
 * name). Per-IP ceilings are loose on purpose: a school lab or a cabina puts
 * thirty students behind one address, and the captcha, not the IP count, is
 * what stops a script on the submit. Per-hold ceilings are tight: one person
 * fills one checkout.
 */
export const RATE_LIMITS = {
  /** Every staff route, per account. Default of `.roles()`/`.owners()`. */
  staff: { name: "staff", by: "user", limit: 600, windowSeconds: 5 * MINUTE },

  /** Turning on the second factor: mailing the code, per account — an inbox, not a budget. */
  staffMfaSend: { name: "staff-mfa-send", by: "user", limit: 5, windowSeconds: 15 * MINUTE },
  /** Turning on the second factor: typing the code (Better Auth also burns a code after 5 misses). */
  staffMfaConfirm: { name: "staff-mfa-confirm", by: "user", limit: 20, windowSeconds: 15 * MINUTE },

  /** The student directory as a file (OOC-121), per account. Each one is the
   * whole base walked in batches and personal data leaving in bulk — a
   * handful an hour is a working day of reports, not a scraper. */
  studentExport: { name: "student-export", by: "user", limit: 10, windowSeconds: 60 * MINUTE },
  /** The audit log as a file (OOC-122), per account — same reasoning as the student export. */
  auditExport: { name: "audit-export", by: "user", limit: 10, windowSeconds: 60 * MINUTE },

  /** Better Auth's catch-all: sign-in, sign-out, session refresh. */
  auth: { name: "auth:ip", by: "ip", limit: 60, windowSeconds: 5 * MINUTE },
  /** Liveness probes and the root banner. */
  probe: { name: "probe:ip", by: "ip", limit: 120, windowSeconds: MINUTE },
  /** Public reads rendered on every page (catalog, feature-flag state). */
  publicRead: { name: "public-read:ip", by: "ip", limit: 600, windowSeconds: 5 * MINUTE },
  /** The staff invite and password-reset links, read and completed. */
  staffLink: { name: "staff-link:ip", by: "ip", limit: 30, windowSeconds: 10 * MINUTE },
  /** "Forgot my password" — sends an e-mail. */
  staffResetRequest: { name: "staff-reset-request:ip", by: "ip", limit: 10, windowSeconds: 10 * MINUTE },

  /** Student portal sign-in, per IP — loose for the same reason as the
   * checkout: a school lab puts thirty students behind one address. */
  portalSignIn: { name: "portal-sign-in:ip", by: "ip", limit: 30, windowSeconds: 10 * MINUTE },
  /** Student "forgot my password" — sends an e-mail. */
  portalResetRequest: { name: "portal-reset-request:ip", by: "ip", limit: 10, windowSeconds: 10 * MINUTE },
  /** Reading and completing a portal access link. */
  portalLink: { name: "portal-link:ip", by: "ip", limit: 30, windowSeconds: 10 * MINUTE },

  /** Checkout: taking and handing back a seat. */
  seatHold: { name: "seat-hold:ip", by: "ip", limit: 60, windowSeconds: 10 * MINUTE },
  /** Checkout: minting and confirming the receipt upload. */
  receiptUpload: { name: "receipt-upload:ip", by: "ip", limit: 60, windowSeconds: 10 * MINUTE },
  /** Checkout: mailing the e-mail verification code. */
  emailVerificationSend: { name: "email-verification-send:ip", by: "ip", limit: 20, windowSeconds: 10 * MINUTE },
  /** Checkout: typing the code. */
  emailVerificationConfirm: { name: "email-verification-confirm:ip", by: "ip", limit: 60, windowSeconds: 10 * MINUTE },
  /** Checkout: the submit. */
  enrollmentSubmit: { name: "enrollment-submit:ip", by: "ip", limit: 60, windowSeconds: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The checkout's per-session ceiling: a rule keyed on the seat hold the
 * request body names in `field` — the hold is the only id a checkout has
 * before the submit, so it is its session.
 */
export function perSeatHold(name: string, limit: number, field: string): RateLimitRule {
  return {
    name: `${name}:hold`,
    by: "key",
    key: (request: FastifyRequest) => {
      const value = (request.body as Record<string, unknown> | undefined)?.[field];
      return typeof value === "string" ? value : null;
    },
    limit,
    windowSeconds: 10 * MINUTE,
  };
}

/**
 * The identifier a portal request names, normalized the way the server reads
 * it — "12.345.678" and "12345678" spend from one counter. Not validated: a
 * malformed one still counts (it is a guess at somebody's account all the
 * same). The plugin hashes the key before it reaches Redis.
 */
export function portalIdentifierKey(body: unknown): string | null {
  const fields = body as Record<string, unknown> | undefined;
  const method = fields?.method;
  const identifier = fields?.identifier;
  if (typeof method !== "string" || typeof identifier !== "string") return null;
  const type = typeof fields?.nationalIdType === "string" ? fields.nationalIdType : "";
  const normalized = method === "email" ? normalizeEmail(identifier) : normalizeNationalId(identifier);
  return `${method}:${type}:${normalized}`;
}

/** Per-account ceiling on a portal route: what stops a guess at one account
 * from thirty IPs that the per-IP rule lets through. */
export function perPortalIdentifier(name: string, limit: number, windowSeconds: number): RateLimitRule {
  return { name: `${name}:id`, by: "key", key: (request: FastifyRequest) => portalIdentifierKey(request.body), limit, windowSeconds };
}

/**
 * Better Auth's own sign-in on the catch-all, per e-mail: the staff login uses
 * it, and a student could call it directly instead of the portal route.
 * Anything else on the catch-all has no key and skips the rule.
 */
export const AUTH_SIGN_IN_BY_EMAIL: RateLimitRule = {
  name: "auth-sign-in:email",
  by: "key",
  key: (request: FastifyRequest) => {
    // Trailing slashes trimmed: the router may well serve `/sign-in/email/`.
    if (!request.url.split("?")[0]!.replace(/\/+$/, "").endsWith("/sign-in/email")) return null;
    const email = (request.body as Record<string, unknown> | undefined)?.email;
    return typeof email === "string" ? normalizeEmail(email) : null;
  },
  limit: 10,
  windowSeconds: 15 * MINUTE,
};
