import { z } from "zod";
import { EMAIL_CATALOG, EMAIL_CATALOG_KEYS, type EmittedEmailKey } from "./emailCatalog.js";

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
  /** A lot (OOC-158): one receipt paying for several enrollments — the same
   * student in more than one course, several children, or both. One e-mail
   * per address, listing the enrollments of the lot that address hears about
   * (`lotRecipients`); `amountCents` is what the whole receipt pays. The
   * single-enrollment payment keeps the four templates above, unchanged. */
  lot_enrollment_received: {
    recipientName: string;
    items: LotEmailItem[];
    amountCents: number;
  };
  lot_payment_under_review: {
    recipientName: string;
    items: LotEmailItem[];
  };
  lot_payment_approved: {
    recipientName: string;
    items: LotEmailItem[];
  };
  lot_payment_rejected: {
    recipientName: string;
    items: LotEmailItem[];
  };
  /** The payment of a paid procedure (OOC-83): its own wording, because the
   * enrollment ones say the seat is confirmed or lost, which is not what
   * deciding a constancia's receipt does. */
  procedure_payment_under_review: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  procedure_payment_approved: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  procedure_payment_rejected: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** A monthly module purchase (OOC-86): its own wording, because the
   * enrollment ones say the seat is confirmed or lost, and a module bought
   * later only opens (or not) that module's class. `modules` is the list of
   * module numbers bought, already joined ("2, 3"). */
  monthly_payment_under_review: {
    recipientName: string;
    studentName: string;
    courseName: string;
    modules: string;
  };
  monthly_payment_approved: {
    recipientName: string;
    studentName: string;
    courseName: string;
    modules: string;
  };
  monthly_payment_rejected: {
    recipientName: string;
    studentName: string;
    courseName: string;
    modules: string;
  };
  /** Progression took a monthly student into a module nobody bought (OOC-86). */
  monthly_module_due: {
    recipientName: string;
    studentName: string;
    courseName: string;
    module: number;
  };
  /** A frozen enrollment's re-engagement, 1, 3 or 6 months after the freeze (OOC-84). */
  enrollment_freeze_reengagement: {
    recipientName: string;
    studentName: string;
    courseName: string;
    months: number;
  };
  /** The final grade was posted (OOC-38) — in review until coordination
   * confirms the register (OOC-180). `grade` is the 0–20 grade as typed (up to
   * two decimals); `passingGrade` is the pass mark from `platform_settings` at
   * the time, so the e-mail never hardcodes 14. */
  grade_posted: {
    recipientName: string;
    studentName: string;
    courseName: string;
    grade: number;
    passingGrade: number;
  };
  /** The final exam was not sat (DA) — the module's grade is DA (OOC-38). */
  grade_did_not_sit: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** The supervision corrected a posted grade (OOC-102): the new grade, and the pass mark of the day. */
  grade_corrected: {
    recipientName: string;
    studentName: string;
    courseName: string;
    grade: number;
    passingGrade: number;
  };
  /** The supervision corrected a posted grade to DA (OOC-102). */
  grade_corrected_did_not_sit: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** The teacher changed a grade while the register was theirs (OOC-180): still in review. */
  grade_updated: {
    recipientName: string;
    studentName: string;
    courseName: string;
    grade: number;
    passingGrade: number;
  };
  /** The teacher changed a grade to DA while the register was theirs (OOC-180). */
  grade_updated_did_not_sit: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** Coordination confirmed the register (OOC-180): the grade is official. */
  grade_official: {
    recipientName: string;
    studentName: string;
    courseName: string;
    grade: number;
    passingGrade: number;
  };
  /** Coordination confirmed the register with the module as DA (OOC-180). */
  grade_official_did_not_sit: {
    recipientName: string;
    studentName: string;
    courseName: string;
  };
  /** The constancia of a paid request was issued (OOC-33). It points to the
   * portal's documents; the PDF is never attached. `code` is the document's
   * verification code. */
  enrollment_certificate_issued: {
    recipientName: string;
    studentName: string;
    courseName: string;
    code: string;
  };
  /** The course certificate was issued in coordination's batch (OOC-33). */
  certificate_issued: {
    recipientName: string;
    studentName: string;
    courseName: string;
    code: string;
  };
  /**
   * The copy of a complaints book sheet (OOC-63): everything the consumer
   * wrote, the supplier as it stood at filing, and the sheet's number. Codes
   * (`kind`, `goodType`, document types) are labelled by the template; null
   * is an optional field left empty, and the guardian's three are null
   * together when the consumer is of age.
   */
  complaint_filed: {
    recipientName: string;
    code: string;
    filedAt: string;
    kind: "claim" | "grievance";
    legalName: string;
    ruc: string;
    supplierAddress: string;
    consumerName: string;
    nationalIdType: "DNI" | "CE" | "passport";
    nationalId: string;
    address: string;
    phone: string;
    email: string;
    guardianName: string | null;
    guardianNationalIdType: "DNI" | "CE" | "passport" | null;
    guardianNationalId: string | null;
    goodType: "product" | "service";
    amountCents: number | null;
    purchasedOn: string | null;
    description: string;
    detail: string;
    request: string;
  };
  /**
   * The company's answer to a complaints book sheet (OOC-58), in the language
   * of the form. `answer` is what the team wrote; `filedAt` is an instant.
   */
  complaint_answered: {
    recipientName: string;
    code: string;
    filedAt: string;
    kind: "claim" | "grievance";
    legalName: string;
    ruc: string;
    answer: string;
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
  /** Somebody was invited to the panel: the link opens the account. The link
   * is a one-time secret, and `accessUrl` is scrubbed from `outbox.vars` on the
   * row's final transition. */
  staff_invite: {
    recipientName: string;
    accessUrl: string;
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

/** One enrollment of a lot, as a lot e-mail lists it: who, what, from when
 * (an ISO date, formatted for the reader when the e-mail is rendered). */
export interface LotEmailItem {
  studentName: string;
  courseName: string;
  startsOn: string;
}

export type EmailTemplateKey = keyof EmailTemplateVars;

/** The catalog's entries emitted today (`emailCatalog.ts`) — the templates
 * `packages/notifications` has to be able to render. */
export const EMAIL_TEMPLATE_KEYS = EMAIL_CATALOG_KEYS.filter(
  (key): key is EmailTemplateKey => EMAIL_CATALOG[key].emitted,
);

/* Fails to compile in either direction: vars for a template the catalog does
   not mark emitted, or an entry marked emitted with no vars to send it with. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _EmittedTemplatesHaveVars = Assert<Same<EmittedEmailKey, EmailTemplateKey>>;

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
