import webpush from "web-push";
import type { Config } from "@/config.js";
import type { PushSubscriptionRow } from "@/infra/persistence/notification/DrizzlePushRepository.js";

/** What reaches the device (OOC-51) — read by `apps/app/public/sw.js`. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification opens: the student's portal. */
  url: string;
  /** One notification per outbox row on the device: a repeat replaces, never stacks. */
  tag: string;
}

/** The push service no longer knows this subscription (404/410): forget it. */
export class PushSubscriptionGoneError extends Error {
  constructor() {
    super("push subscription gone");
    this.name = "PushSubscriptionGoneError";
  }
}

/** The push service refused or could not be reached; `code` is safe to log. */
export class PushDeliveryError extends Error {
  constructor(readonly code: string) {
    super(`push delivery failed: ${code}`);
    this.name = "PushDeliveryError";
  }
}

export interface PushSender {
  send(subscription: PushSubscriptionRow, payload: PushPayload): Promise<void>;
}

/** How long the push service keeps trying a device that is offline. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** A push service that takes longer than this is treated as down. */
const PUSH_TIMEOUT_MS = 10_000;

/**
 * Web Push through the `web-push` library: it encrypts the payload to the
 * browser's keys (RFC 8291) and signs the request with our VAPID key
 * (RFC 8292), so the push service delivers it without ever reading it.
 */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  async send(subscription: PushSubscriptionRow, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: PUSH_TTL_SECONDS, urgency: "normal", timeout: PUSH_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        if (error.statusCode === 404 || error.statusCode === 410) throw new PushSubscriptionGoneError();
        throw new PushDeliveryError(`push_http_${error.statusCode}`);
      }
      throw new PushDeliveryError("push_network");
    }
  }
}

/**
 * Push is optional, like the e-mail provider's key: without the VAPID pair
 * the portal does not offer it and nothing is sent — a missing secret never
 * takes the API down (index.ts warns in production).
 */
export function createPushSender(config: Config): { sender: PushSender; publicKey: string } | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
  return {
    sender: new WebPushSender({
      subject: config.VAPID_SUBJECT,
      publicKey: config.VAPID_PUBLIC_KEY,
      privateKey: config.VAPID_PRIVATE_KEY,
    }),
    publicKey: config.VAPID_PUBLIC_KEY,
  };
}
