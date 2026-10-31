import type { EmailTemplateKey } from "./EmailNotification.js";

/*
 * The e-mails that did not land (OOC-90): which outbox rows the backoffice
 * lists as somebody to reach, what their failure means to a reader, and which
 * ones a person may send again.
 *
 * The outbox has no `student_id` — a row is one message to one address — so
 * the person is read back from the subject its dedupe key names
 * (`<template>:<subject id>:<recipient kind>`, `insertOutboxEmails`).
 */

/** What the subject id in a template's dedupe key points at. */
export type DeliverySubject = "enrollment" | "payment" | "student_account";

/**
 * The templates about a student, and where their dedupe key leads. The rest
 * stays off the screen: a staff e-mail has no student file, and the checkout's
 * verification code is written before any file exists and expires in minutes.
 */
export const STUDENT_DELIVERY_SUBJECTS = {
  enrollment_received: "enrollment",
  payment_under_review: "payment",
  payment_approved: "payment",
  payment_rejected: "payment",
  portal_credentials: "student_account",
  portal_password_reset: "student_account",
} as const satisfies Partial<Record<EmailTemplateKey, DeliverySubject>>;

export type StudentDeliveryTemplate = keyof typeof STUDENT_DELIVERY_SUBJECTS;

export const STUDENT_DELIVERY_TEMPLATES = Object.keys(STUDENT_DELIVERY_SUBJECTS) as StudentDeliveryTemplate[];

export function isStudentDeliveryTemplate(template: string): template is StudentDeliveryTemplate {
  return Object.hasOwn(STUDENT_DELIVERY_SUBJECTS, template);
}

/**
 * The templates a resend can send again as they were. The portal ones are
 * not: their link carries a one-time token whose only copy was stripped from
 * the row when it failed (`stripOneTimeSecrets`) — a fresh one is what the
 * student file's "Send portal access" issues.
 */
const RESENDABLE: ReadonlySet<StudentDeliveryTemplate> = new Set([
  "enrollment_received",
  "payment_under_review",
  "payment_approved",
  "payment_rejected",
]);

export function isResendableTemplate(template: string): boolean {
  return isStudentDeliveryTemplate(template) && RESENDABLE.has(template);
}

/**
 * Why a row failed, as far as the outbox knows. Mailbox full, unknown address
 * and a bounce only exist once the provider's webhook reports them — until
 * then every row is a send that failed, and this says which side failed it.
 *
 * - `provider_unavailable` — the provider never answered, or answered 5xx/429,
 *   and the retries ran out.
 * - `provider_refused` — the provider turned the message down (4xx).
 * - `template_error` — the platform could not write the e-mail.
 */
export const DELIVERY_FAILURE_REASONS = ["provider_unavailable", "provider_refused", "template_error"] as const;

export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

/** `last_error` holds a code, never the provider's text (`outbox` schema). */
export function deliveryFailureReason(lastError: string | null): DeliveryFailureReason {
  if (lastError === "template_render") return "template_error";
  const status = /^brevo_http_(\d{3})/.exec(lastError ?? "")?.[1];
  if (status && status.startsWith("4") && status !== "429") return "provider_refused";
  return "provider_unavailable";
}

export type DeliveryRecipientKind = "student" | "guardian";

/**
 * The subject id and recipient kind a dedupe key carries. The portal
 * templates end in a token id, not a kind: they only ever go to the student.
 */
export function parseDeliveryDedupeKey(dedupeKey: string): { subjectId: string; recipientKind: DeliveryRecipientKind } {
  const [, subjectId = "", kind] = dedupeKey.split(":");
  return { subjectId, recipientKind: kind === "guardian" ? "guardian" : "student" };
}

/**
 * The dedupe key of a row's resend. Derived from the failed row, so a second
 * click on the same row is a no-op in the database; a resend that fails too
 * gets its own, one suffix longer.
 */
export function resendDedupeKey(dedupeKey: string): string {
  return `${dedupeKey}:resend`;
}
