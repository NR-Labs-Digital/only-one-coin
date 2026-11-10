import {
  EmailDeliveryError,
  RecipientNotAllowedError,
  TemplateRenderError,
  type NotificationProvider,
  type OutgoingEmail,
} from "@ooc/notifications";
import type { IOutboxStore } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

export type DeliveryOutcome = "sent" | "blocked" | "failed" | "skipped";

export interface DeliverOutboxEmailDeps {
  store: IOutboxStore;
  provider: NotificationProvider;
  /** Whether the queue will give this job another try if it throws. */
  isFinalAttempt: boolean;
}

/**
 * One outbox row through the provider, and its row updated with what
 * happened. Throws only when the failure is transient AND the queue still
 * has attempts left — that throw is what makes BullMQ retry with backoff.
 * Everything else ends the row here:
 *
 * - `skipped` — the row is gone or already reached an end state (a job that
 *   ran twice, a relay that offered it again). Nothing is sent twice.
 * - `blocked` — the allowlist guard refused the recipient outside production
 *   (CLAUDE.md §6). A decision, not a failure: never retried.
 * - `failed`  — the provider said no for good (4xx), the template could not
 *   render, or the last retry was spent.
 */
export async function deliverOutboxEmail(outboxId: string, deps: DeliverOutboxEmailDeps): Promise<DeliveryOutcome> {
  const row = await deps.store.findById(outboxId);
  if (!row || row.status !== "pending") return "skipped";

  // The row was written from an EmailNotification of this same template key
  // (insertOutboxEmails), so its vars are that template's vars.
  const email = {
    to: row.recipient,
    templateKey: row.templateKey,
    locale: row.locale,
    vars: row.vars,
    ...(row.isProof ? { proof: true } : {}),
  } as OutgoingEmail;

  try {
    const { providerId } = await deps.provider.sendEmail(email);
    await deps.store.markSent(row.id, providerId);
    return "sent";
  } catch (error) {
    if (error instanceof RecipientNotAllowedError) {
      await deps.store.markBlocked(row.id);
      return "blocked";
    }

    if (error instanceof TemplateRenderError) {
      await deps.store.recordFailedAttempt(row.id, "template_render", true);
      return "failed";
    }

    if (error instanceof EmailDeliveryError && !error.retryable) {
      await deps.store.recordFailedAttempt(row.id, error.code, true);
      return "failed";
    }

    const code = error instanceof EmailDeliveryError ? error.code : "unexpected";
    await deps.store.recordFailedAttempt(row.id, code, deps.isFinalAttempt);
    if (deps.isFinalAttempt) return "failed";
    throw error;
  }
}
