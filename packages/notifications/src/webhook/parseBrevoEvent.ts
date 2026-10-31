import type { EmailDeliveryEvent, EmailDeliveryKind, EmailDeliveryReason } from "@ooc/domain";
import { z } from "zod";

/**
 * Brevo's transactional webhook body — one JSON object per event. Only what
 * the platform uses is read; the address (`email`) and the subject are
 * deliberately not: the message is found by its id, and nothing here has a
 * reason to copy a recipient anywhere.
 */
const BrevoWebhookBodySchema = z.object({
  event: z.string().min(1),
  "message-id": z.string().min(1),
  reason: z.string().optional(),
  ts_epoch: z.number().optional(),
  ts_event: z.number().optional(),
  date: z.string().optional(),
});

export type ParsedBrevoEvent =
  /** An event the platform records. */
  | { kind: "event"; event: EmailDeliveryEvent }
  /** A valid Brevo event we do not record (request, opened, click, deferred…). */
  | { kind: "ignored" };

const EVENT_KINDS: Record<string, EmailDeliveryKind> = {
  delivered: "delivered",
  soft_bounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  // The address is syntactically unusable: the same dead end as a hard bounce.
  invalid_email: "hard_bounce",
  blocked: "blocked",
  unsubscribed: "unsubscribed",
};

/** Brevo's `blocked` has no reason of its own; the closest code we have. */
const BLOCKED_REASON: EmailDeliveryReason = "blocked_by_server";

/**
 * The receiving server's explanation is free text (`"550 5.1.1 user unknown"`,
 * `"mailbox is full"`). It is reduced to a code here and never kept: it can
 * carry the address. Order matters — "domain" is checked after the mailbox
 * phrases because "unknown user at domain" is an unknown address, not a bad domain.
 */
export function classifyBounceReason(text: string | undefined): EmailDeliveryReason {
  const reason = (text ?? "").toLowerCase();
  if (/mailbox.*(full|quota)|over.?quota|quota.?exceeded|insufficient.*storage|storage.*full/.test(reason)) {
    return "mailbox_full";
  }
  if (/user unknown|unknown user|no such user|does not exist|doesn't exist|invalid (mailbox|recipient|address)|recipient (address )?rejected|address rejected|5\.1\.1|mailbox (not found|unavailable)/.test(reason)) {
    return "address_unknown";
  }
  if (/domain|no mx|host not found|nxdomain|dns/.test(reason)) return "domain_invalid";
  if (/block|spam|blacklist|blocklist|reputation|policy|denied|refused/.test(reason)) return "blocked_by_server";
  return "other";
}

/** Angle brackets are how Brevo spells the id in one place and not the other. */
export function normalizeProviderMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
}

/** Returns null when the body is not a usable Brevo event. */
export function parseBrevoEvent(body: unknown): ParsedBrevoEvent | null {
  const parsed = BrevoWebhookBodySchema.safeParse(body);
  if (!parsed.success) return null;

  const { event, reason, ts_epoch, ts_event, date } = parsed.data;
  const kind = EVENT_KINDS[event];
  if (!kind) return { kind: "ignored" };

  const messageId = normalizeProviderMessageId(parsed.data["message-id"]);
  const occurredAt = occurredAtOf({ ts_epoch, ts_event, date });
  // No instant, no stable dedupe key — a retried webhook would be recorded again.
  if (!occurredAt) return null;

  return {
    kind: "event",
    event: {
      messageId,
      kind,
      reason: reasonOf(kind, event, reason),
      occurredAt,
      dedupeKey: `${messageId}:${kind}:${occurredAt.getTime()}`,
    },
  };
}

function reasonOf(kind: EmailDeliveryKind, event: string, text: string | undefined): EmailDeliveryReason | null {
  if (kind === "blocked") return BLOCKED_REASON;
  if (event === "invalid_email") return "address_unknown";
  if (kind === "hard_bounce" || kind === "soft_bounce") return classifyBounceReason(text);
  return null;
}

/** `ts_epoch` is milliseconds, `ts_event` seconds. Null when the body carries no usable instant. */
function occurredAtOf(fields: { ts_epoch?: number; ts_event?: number; date?: string }): Date | null {
  if (fields.ts_epoch !== undefined) return new Date(fields.ts_epoch);
  if (fields.ts_event !== undefined) return new Date(fields.ts_event * 1000);
  if (fields.date !== undefined) {
    const parsed = new Date(fields.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}
