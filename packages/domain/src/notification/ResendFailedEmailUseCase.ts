import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import { isResendableTemplate, isStudentDeliveryTemplate, resendDedupeKey } from "./emailDelivery.js";

/** An outbox row as the resend reads it. */
export interface FailedDelivery {
  id: string;
  templateKey: string;
  dedupeKey: string;
  status: "pending" | "sent" | "blocked" | "failed";
  /** The file the row's subject leads to; null when it no longer resolves. */
  studentId: string | null;
}

export interface IEmailDeliveryRepository {
  findDelivery(outboxId: string): Promise<FailedDelivery | null>;
  /**
   * Writes the resend row — same template, locale and vars, addressed to what
   * the file says today — and the audit entry, in one transaction. Null when a
   * row with `dedupeKey` already exists: somebody resent it first.
   */
  resend(params: { delivery: FailedDelivery; dedupeKey: string; audit: (outboxId: string) => AuditLogEntry }): Promise<{ outboxId: string } | null>;
}

export interface ResendFailedEmailInput {
  actorId: string;
  outboxId: string;
}

/**
 * "Resend" on the undelivered e-mails screen (OOC-90). An audited exception,
 * never a routine (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4): it only exists for
 * a row that failed, it writes a NEW outbox row (the failed one stays as the
 * record of what happened), and the audit entry commits with it.
 *
 * It goes to the address on the file today, not the one that failed — fixing
 * the address and resending is exactly what the screen sends people to do.
 */
export class ResendFailedEmailUseCase extends BaseUseCase<ResendFailedEmailInput, { outboxId: string }> {
  constructor(private readonly deliveries: IEmailDeliveryRepository) {
    super();
  }

  async run(input: ResendFailedEmailInput): Promise<{ outboxId: string }> {
    const delivery = await this.deliveries.findDelivery(input.outboxId);
    // Staff e-mails and verification codes are not on the screen, so they
    // cannot be resent from it either.
    if (!delivery || !isStudentDeliveryTemplate(delivery.templateKey)) {
      throw new NotFoundError({ reason: "email_delivery.not_found", message: "No such delivery." });
    }

    if (delivery.status !== "failed") {
      throw new ConflictError({ reason: "email_delivery.not_failed", message: "Only a failed delivery is resent." });
    }

    if (!isResendableTemplate(delivery.templateKey)) {
      throw new UnableToProcessEntryError({
        reason: "email_delivery.not_resendable",
        message: "This e-mail carries a one-time link; issue a new one from the student file.",
      });
    }

    const result = await this.deliveries.resend({
      delivery,
      dedupeKey: resendDedupeKey(delivery.dedupeKey),
      audit: (outboxId) => ({
        actorId: input.actorId,
        action: "email.resent",
        targetId: delivery.id,
        // Never the address: audit_log is append-only (CLAUDE.md §8).
        metadata: { template: delivery.templateKey, resentAs: outboxId, studentId: delivery.studentId },
        at: new Date(),
      }),
    });

    if (!result) {
      throw new ConflictError({ reason: "email_delivery.already_resent", message: "This delivery was already resent." });
    }

    return result;
  }
}
