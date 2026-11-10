import type { IEmailProofRepository } from "@ooc/domain";
import { auditLog, outbox } from "@ooc/db";
import type { Db } from "@/infra/db/client.js";

/**
 * The proof send of the e-mail screen (OOC-89). Proof rows are ordinary
 * outbox rows with `is_proof` on: the relay and the worker deliver them like
 * any other — through the allowlist guard outside production — and the
 * screens that count or resend what went to students leave them out.
 */
export class DrizzleEmailProofRepository implements IEmailProofRepository {
  constructor(private readonly db: Db) {}

  async send(params: Parameters<IEmailProofRepository["send"]>[0]): Promise<{ outboxIds: string[] }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(outbox)
        .values(
          params.messages.map((message) => ({
            channel: "email",
            templateKey: message.templateKey,
            recipient: message.to,
            locale: message.locale,
            vars: message.vars,
            dedupeKey: message.dedupeKey,
            isProof: true,
          })),
        )
        .returning({ id: outbox.id });

      const outboxIds = rows.map((row) => row.id);
      const entry = params.audit(outboxIds);
      await tx.insert(auditLog).values({
        actorId: entry.actorId,
        action: entry.action,
        targetId: entry.targetId,
        metadata: entry.metadata ?? null,
        createdAt: entry.at,
      });

      return { outboxIds };
    });
  }
}
