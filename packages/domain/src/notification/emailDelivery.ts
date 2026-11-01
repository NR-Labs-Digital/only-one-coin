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

/**
 * What an e-mail provider can tell us about a message after it took it
 * (OOC-91). A closed vocabulary on purpose: the provider's own words are
 * free text that can echo the recipient's address back, so only these codes
 * are ever stored, logged or shown (CLAUDE.md §6, "PII em log"; CLAUDE.md §4,
 * "zero código de domínio na tela" — the screen resolves each one by locale).
 *
 * Opens and clicks are not here: they would mean a tracking pixel on every
 * message, and that is a consent question (Ley 29733), not a metric.
 */
export const EMAIL_DELIVERY_KINDS = ["delivered", "soft_bounce", "hard_bounce", "blocked", "unsubscribed"] as const;
export type EmailDeliveryKind = (typeof EMAIL_DELIVERY_KINDS)[number];

/** Why a message did not land. Only bounces and blocks carry one. */
export const EMAIL_DELIVERY_REASONS = [
  /** The classic: a Gmail with no space left (`docs/REGRAS-NEGOCIO.md` §7). */
  "mailbox_full",
  "address_unknown",
  "domain_invalid",
  "blocked_by_server",
  "other",
] as const;
export type EmailDeliveryReason = (typeof EMAIL_DELIVERY_REASONS)[number];

/** The outbox's last word on a message, one per event kind. */
export type EmailDeliveryStatus = "delivered" | "soft_bounced" | "hard_bounced" | "blocked" | "unsubscribed";

const STATUS_OF: Record<EmailDeliveryKind, EmailDeliveryStatus> = {
  delivered: "delivered",
  soft_bounce: "soft_bounced",
  hard_bounce: "hard_bounced",
  blocked: "blocked",
  unsubscribed: "unsubscribed",
};

export function deliveryStatusOf(kind: EmailDeliveryKind): EmailDeliveryStatus {
  return STATUS_OF[kind];
}

/**
 * Webhooks arrive out of order and are retried, so "the latest event wins"
 * would let a late soft bounce overwrite a delivery. The status only moves up:
 * a retry that finally delivers beats the soft bounce before it, and a hard
 * bounce is the end of the story whatever else arrives.
 */
const STATUS_RANK: Record<EmailDeliveryStatus, number> = {
  soft_bounced: 1,
  delivered: 2,
  blocked: 3,
  unsubscribed: 3,
  hard_bounced: 4,
};

export function deliveryStatusRank(status: EmailDeliveryStatus): number {
  return STATUS_RANK[status];
}

/** One thing the provider reported, already reduced to the closed vocabulary. */
export interface EmailDeliveryEvent {
  /** The provider's id for the message, as `outbox.provider_message_id` holds it (angle brackets aside). */
  messageId: string;
  kind: EmailDeliveryKind;
  reason: EmailDeliveryReason | null;
  /** When the provider says it happened. */
  occurredAt: Date;
  /** `<message id>:<kind>:<instant>` — the same event replayed carries the same key. */
  dedupeKey: string;
}
