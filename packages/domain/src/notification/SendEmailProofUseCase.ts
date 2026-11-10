// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import { normalizeEmail } from "../student/fields.js";
import type { EmailTemplateKey, Locale } from "./EmailNotification.js";

/** How many addresses one proof goes to — the same ceiling the screen keeps. */
export const MAX_EMAIL_PROOF_RECIPIENTS = 5;

/** One proof message, as the outbox stores it: sample data, marked as a proof. */
export interface EmailProofMessage {
  templateKey: EmailTemplateKey;
  to: string;
  locale: Locale;
  vars: Record<string, unknown>;
  dedupeKey: string;
}

export interface IEmailProofRepository {
  /** Writes every message as a proof row and the audit entry, in one transaction. */
  send(params: { messages: EmailProofMessage[]; audit: (outboxIds: string[]) => AuditLogEntry }): Promise<{
    outboxIds: string[];
  }>;
}

export interface SendEmailProofInput {
  actorId: string;
  templateKey: EmailTemplateKey;
  locale: Locale;
  recipients: string[];
  /** The template's sample data — invented, never a real student's (OOC-88). */
  vars: Record<string, unknown>;
}

// Deliberately loose: an address the provider cannot take fails in the outbox
// like any other, and this only catches what is obviously not one.
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A proof of an automatic e-mail (OOC-89): the repository's template over the
 * preview's sample data, to up to five addresses somebody typed, with the
 * subject marked. It goes through the outbox like every other e-mail, so the
 * staging allowlist (`AllowlistGuard`, CLAUDE.md §6) refuses any address off
 * the list exactly as it would a real message.
 *
 * The audit entry names the template, the language, how many addresses and
 * the outbox rows — never the addresses themselves: `audit_log` is append-only
 * (CLAUDE.md §8), and the outbox row already says where each one went.
 */
export class SendEmailProofUseCase extends BaseUseCase<SendEmailProofInput, { outboxIds: string[] }> {
  constructor(private readonly proofs: IEmailProofRepository) {
    super();
  }

  async run(input: SendEmailProofInput): Promise<{ outboxIds: string[] }> {
    const recipients = input.recipients.map(normalizeEmail);

    if (recipients.length === 0) {
      throw new UnableToProcessEntryError({ reason: "email_proof.no_recipients", message: "Add at least one address." });
    }
    if (recipients.length > MAX_EMAIL_PROOF_RECIPIENTS) {
      throw new UnableToProcessEntryError({
        reason: "email_proof.too_many_recipients",
        message: `A proof goes to ${MAX_EMAIL_PROOF_RECIPIENTS} addresses at most.`,
      });
    }
    if (recipients.some((address) => !ADDRESS.test(address))) {
      throw new UnableToProcessEntryError({ reason: "email_proof.invalid_recipient", message: "Not an address." });
    }
    if (new Set(recipients).size !== recipients.length) {
      throw new UnableToProcessEntryError({
        reason: "email_proof.duplicate_recipient",
        message: "The same address twice.",
      });
    }

    // Every proof is a new message: the key is unique per send, so sending
    // the same proof twice sends it twice — that is what the button means.
    const proofId = uuid();
    const messages = recipients.map((to, index) => ({
      templateKey: input.templateKey,
      to,
      locale: input.locale,
      vars: input.vars,
      dedupeKey: `proof:${input.templateKey}:${proofId}:${index}`,
    }));

    return this.proofs.send({
      messages,
      audit: (outboxIds) => ({
        actorId: input.actorId,
        action: "email.proof_sent",
        targetId: proofId,
        metadata: { template: input.templateKey, locale: input.locale, recipients: recipients.length, outboxIds },
        at: new Date(),
      }),
    });
  }
}
