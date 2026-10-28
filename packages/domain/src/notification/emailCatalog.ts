/*
 * Every automatic e-mail the platform has or plans to have (OOC-87) — one
 * copy, read by `apps/api` (through `EmailTemplateKey`, which must be exactly
 * the entries emitted today) and by `apps/app` (the e-mail screens, through
 * the `@ooc/domain/email-catalog` subpath).
 *
 * Imported raw by the Next.js build, so it stays self-contained: no
 * dependency, no relative import.
 *
 * The key is a code; the screen translates it (CLAUDE.md §4), and
 * `apps/app/src/lib/backoffice/email-catalog.test.ts` fails when a locale is
 * missing one.
 */

/**
 * The domain events the student's e-mails hang off, in the order they happen
 * — the journey screen's spine and the catalog's order.
 */
export const EMAIL_STAGES = ["submitted", "payment_pending", "payment_settled", "access", "documents"] as const;

export type EmailStage = (typeof EMAIL_STAGES)[number];

/**
 * Who the template is written to. `staff` is internal: nobody outside the
 * institution receives it. A minor's guardian gets a copy of the enrollment
 * e-mails (`enrollmentRecipients`), but none is written to the guardian.
 */
export const EMAIL_AUDIENCES = ["student", "staff"] as const;

export type EmailAudience = (typeof EMAIL_AUDIENCES)[number];

interface EmailCatalogEntry {
  audience: EmailAudience;
  /**
   * The step of the student's journey it leaves because of. Null for what is
   * not a step of it: account security, and anything sent to staff.
   */
  stage: EmailStage | null;
  /** Fires only when the case takes that turn — a branch, not a step everybody walks. */
  conditional: boolean;
  /**
   * Whether the platform writes it to the outbox today. False is a template
   * the rules describe (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4,
   * `docs/REGRAS-NEGOCIO.md` §5) and nothing sends yet.
   */
  emitted: boolean;
}

export const EMAIL_CATALOG = {
  enrollment_received: { audience: "student", stage: "submitted", conditional: false, emitted: true },
  /* The receipt pipeline sent it to a person: screening signal, or a yellow
     or red traffic light. */
  payment_under_review: { audience: "student", stage: "payment_pending", conditional: true, emitted: true },
  payment_approved: { audience: "student", stage: "payment_settled", conditional: false, emitted: true },
  payment_rejected: { audience: "student", stage: "payment_settled", conditional: true, emitted: true },
  /* The first approval opens the portal account. */
  portal_credentials: { audience: "student", stage: "access", conditional: false, emitted: true },
  /* The Classroom invitation, three days before the class group starts
     (`docs/REGRAS-NEGOCIO.md` §5, step 9 — two days in one FAQ, §11). */
  class_access_ready: { audience: "student", stage: "access", conditional: false, emitted: false },
  enrollment_certificate_issued: { audience: "student", stage: "documents", conditional: true, emitted: false },
  certificate_issued: { audience: "student", stage: "documents", conditional: false, emitted: false },

  email_verification_code: { audience: "student", stage: null, conditional: false, emitted: true },
  portal_password_reset: { audience: "student", stage: null, conditional: true, emitted: true },
  staff_password_reset: { audience: "staff", stage: null, conditional: true, emitted: true },
  staff_mfa_code: { audience: "staff", stage: null, conditional: false, emitted: true },
} as const satisfies Record<string, EmailCatalogEntry>;

export type EmailCatalogKey = keyof typeof EMAIL_CATALOG;

export const EMAIL_CATALOG_KEYS = Object.keys(EMAIL_CATALOG) as EmailCatalogKey[];

/** The entries the platform sends today — what `EmailTemplateKey` must equal. */
export type EmittedEmailKey = {
  [K in EmailCatalogKey]: (typeof EMAIL_CATALOG)[K]["emitted"] extends true ? K : never;
}[EmailCatalogKey];
