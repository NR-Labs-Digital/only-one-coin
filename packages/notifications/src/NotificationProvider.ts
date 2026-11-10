import type { EmailNotification } from "@ooc/domain";

/** One rendered-and-sent message: an `outbox` row minus its bookkeeping. */
export type OutgoingEmail = Omit<EmailNotification, "dedupeKey"> & {
  /** A proof from the e-mail screen (OOC-89): the subject goes out marked. */
  proof?: boolean;
};

/**
 * The only thing the rest of the platform knows about e-mail delivery
 * (apps/api/CLAUDE.md, "Notificações"). The system does not know Brevo; it
 * knows this. Templates are rendered from this repository by the
 * implementation — never designed only in the provider's dashboard.
 */
export interface NotificationProvider {
  sendEmail(email: OutgoingEmail): Promise<{ providerId: string }>;
}

/**
 * The provider could not deliver. `retryable` separates "try again later"
 * (a 5xx, a 429, a network failure) from "this will never work as written"
 * (a 4xx) — the worker retries the first and gives up on the second.
 *
 * `code` is a short machine code (`brevo_http_400_invalid_parameter`), never
 * the provider's free-text message: that one can echo the recipient address
 * back, and it ends up in `outbox.last_error` and the logs (CLAUDE.md §6,
 * "PII em log").
 */
export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`E-mail delivery failed: ${code}`);
    this.name = "EmailDeliveryError";
  }
}

/** The allowlist guard refused the recipient outside production (CLAUDE.md
 * §6). A decision, not a failure — never retried. */
export class RecipientNotAllowedError extends Error {
  constructor() {
    super("Recipient is not on the e-mail allowlist for this environment");
    this.name = "RecipientNotAllowedError";
  }
}
