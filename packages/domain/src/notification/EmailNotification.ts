import { z } from "zod";

/**
 * The three locales everything the user reads ships in (CLAUDE.md §4), es-PE
 * being the default and the fallback. The public app routes on short codes
 * (es/en/pt); these are the full names the locale files carry.
 */
export const LocaleSchema = z.enum(["es-PE", "pt-BR", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;
export const DEFAULT_LOCALE: Locale = "es-PE";

/**
 * Every transactional e-mail the platform knows how to send, and what each
 * one needs to be written. Vars are plain JSON on purpose — they are stored in
 * `outbox.vars` and rendered later by the worker, so a date travels as an ISO
 * string and money as `amountCents` (CLAUDE.md §6: never a float), formatted
 * for the reader's locale and America/Lima only when the e-mail is rendered.
 *
 * `recipientName` is who the e-mail greets; `studentName` is who it is about.
 * They differ on the guardian's copy of a minor's enrollment (CLAUDE.md §1).
 */
export interface EmailTemplateVars {
  enrollment_received: {
    recipientName: string;
    studentName: string;
    courseName: string;
    startsOn: string;
    amountCents: number;
  };
  payment_under_review: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  payment_approved: {
    recipientName: string;
    studentName: string;
    courseName: string;
    startsOn: string;
  };
  payment_rejected: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** The portal account was created: the link sets the first password (never the password itself — outbox.vars is plain text). */
  portal_credentials: {
    recipientName: string;
    loginEmail: string;
    accessUrl: string;
  };
  /** A staff member asked for a new password from the panel's login (OOC-30). */
  staff_password_reset: {
    recipientName: string;
    resetUrl: string;
  };
  /** A student asked for a new portal password (05/10/2026). */
  portal_password_reset: {
    recipientName: string;
    resetUrl: string;
  };
  /** The checkout's 6-digit code proving the student's Gmail (spec 2026-10-07).
   * Plain text in `outbox.vars` only until the row's final transition. */
  email_verification_code: {
    recipientName: string;
    code: string;
  };
  /** The staff panel's second-factor code (OOC-29), at sign-in or while turning
   * the factor on. Plain text in `outbox.vars` only until the row's final transition. */
  staff_mfa_code: {
    recipientName: string;
    code: string;
  };
}

export type EmailTemplateKey = keyof EmailTemplateVars;

export const EMAIL_TEMPLATE_KEYS = [
  "enrollment_received",
  "payment_under_review",
  "payment_approved",
  "payment_rejected",
  "portal_credentials",
  "staff_password_reset",
  "portal_password_reset",
  "email_verification_code",
  "staff_mfa_code",
] as const satisfies readonly EmailTemplateKey[];

/** One message to one recipient — the shape of one `outbox` row. A union over
 * the template keys, so the vars can never belong to another template. */
export type EmailNotification = {
  [K in EmailTemplateKey]: {
    templateKey: K;
    to: string;
    locale: Locale;
    vars: EmailTemplateVars[K];
    /** `<template>:<subject id>:<recipient kind>` — writing the same key twice
     * is a no-op, which is what makes emitting safe to retry. */
    dedupeKey: string;
  };
}[EmailTemplateKey];
