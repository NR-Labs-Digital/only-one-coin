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
