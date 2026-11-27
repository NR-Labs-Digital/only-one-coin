import { isEditableEmailKey, type EmailCopy, type EmailTemplateContent } from "@ooc/domain";
import {
  EmailDeliveryError,
  RecipientNotAllowedError,
  TemplateRenderError,
  renderEmail,
  type NotificationProvider,
  type OutgoingEmail,
} from "@ooc/notifications";
import type { IOutboxStore } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

export type DeliveryOutcome = "sent" | "blocked" | "failed" | "skipped";

/** Where the words published in the backoffice come from (OOC-60). */
export interface PublishedEmailWording {
  findPublished(templateKey: string): Promise<{ id: string; version: number; content: EmailTemplateContent } | null>;
}

export interface DeliverOutboxEmailDeps {
  store: IOutboxStore;
  wording: PublishedEmailWording;
  /** A published version that no longer renders, so the repository's words went out instead. */
  onStaleWording?: (info: { outboxId: string; templateVersionId: string }) => void;
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

  const { copy, templateVersionId } = await wordingFor(email, row.id, row.templateCopy, deps);

  try {
    const { providerId } = await deps.provider.sendEmail(copy ? { ...email, copy } : email);
    await deps.store.markSent(row.id, providerId, templateVersionId);
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

/**
 * The words the e-mail goes out with (OOC-60), read at the moment it is sent:
 *
 * - a proof of a draft carries its own, frozen when it was asked for;
 * - otherwise, the version published in the backoffice, if any — and the row
 *   records which, so the outbox says what each person received;
 * - otherwise, the repository's.
 *
 * A published version that no longer renders falls back to the repository's
 * words instead of failing the e-mail: the code can change a template's vars
 * after the version was published (a var renamed, a list added), and the
 * student still has to hear that the payment was approved. The fallback is
 * reported, and the row's version stays null — it is what went out.
 */
async function wordingFor(
  email: OutgoingEmail,
  outboxId: string,
  frozen: EmailCopy | null,
  deps: DeliverOutboxEmailDeps,
): Promise<{ copy: EmailCopy | null; templateVersionId: string | null }> {
  if (frozen) return { copy: frozen, templateVersionId: null };
  if (!isEditableEmailKey(email.templateKey)) return { copy: null, templateVersionId: null };

  const published = await deps.wording.findPublished(email.templateKey);
  const copy = published?.content[email.locale];
  if (!published || !copy) return { copy: null, templateVersionId: null };

  try {
    renderEmail({ ...email, copy });
    return { copy, templateVersionId: published.id };
  } catch (error) {
    if (!(error instanceof TemplateRenderError)) throw error;
    deps.onStaleWording?.({ outboxId, templateVersionId: published.id });
    return { copy: null, templateVersionId: null };
  }
}
