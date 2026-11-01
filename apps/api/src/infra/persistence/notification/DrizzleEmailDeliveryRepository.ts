import { auditLog, outbox, outboxDeliveryEvents, students } from "@ooc/db";
import { deliveryStatusOf, deliveryStatusRank, type EmailDeliveryEvent } from "@ooc/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** What recording one provider event did — the route logs it, never the address. */
export type EmailDeliveryOutcome =
  /** Stored. `studentsMarked` is the files whose e-mail a hard bounce flagged. */
  | { kind: "recorded"; studentsMarked: number }
  /** The same event again: Brevo retries a webhook it did not see answered. */
  | { kind: "duplicate" }
  /** No outbox row carries that message id — a campaign, or another environment. */
  | { kind: "unknown_message" };

export interface IEmailDeliveryRecorder {
  record(event: EmailDeliveryEvent): Promise<EmailDeliveryOutcome>;
}

/**
 * The actor of an `audit_log` entry nobody typed: the provider told us. Not a
 * `"user".id`, and the log's reader tolerates an actor with no account.
 */
export const BREVO_AUDIT_ACTOR = "system:brevo";

/**
 * The outbox's `delivery_status` only moves up (`deliveryStatusRank`): the
 * ranks live in the domain, and this is the same table in SQL so the guard is
 * one conditional UPDATE and not a read followed by a write. The ranks are
 * inlined (`sql.raw`, closed numbers from our own table): as bind parameters in
 * a `CASE` Postgres cannot infer their type.
 */
const rankOf = (status: ReturnType<typeof sql>) => sql`case ${status}
  when 'soft_bounced' then ${sql.raw(String(deliveryStatusRank("soft_bounced")))}
  when 'delivered' then ${sql.raw(String(deliveryStatusRank("delivered")))}
  when 'blocked' then ${sql.raw(String(deliveryStatusRank("blocked")))}
  when 'unsubscribed' then ${sql.raw(String(deliveryStatusRank("unsubscribed")))}
  when 'hard_bounced' then ${sql.raw(String(deliveryStatusRank("hard_bounced")))}
  else 0 end`;

export class DrizzleEmailDeliveryRepository implements IEmailDeliveryRecorder {
  constructor(private readonly db: Db) {}

  async record(event: EmailDeliveryEvent): Promise<EmailDeliveryOutcome> {
    return this.db.transaction(async (tx) => {
      // The id has angle brackets on one side and not the other — see the
      // expression index `outbox_provider_message_id_idx`.
      const [message] = await tx
        .select({ id: outbox.id, recipient: outbox.recipient })
        .from(outbox)
        .where(sql`trim(both '<>' from ${outbox.providerMessageId}) = ${event.messageId}`)
        .limit(1);
      if (!message) return { kind: "unknown_message" } as const;

      const inserted = await tx
        .insert(outboxDeliveryEvents)
        .values({
          outboxId: message.id,
          kind: event.kind,
          reason: event.reason,
          dedupeKey: event.dedupeKey,
          occurredAt: event.occurredAt,
        })
        .onConflictDoNothing({ target: outboxDeliveryEvents.dedupeKey })
        .returning({ id: outboxDeliveryEvents.id });
      if (inserted.length === 0) return { kind: "duplicate" } as const;

      const status = deliveryStatusOf(event.kind);
      await tx
        .update(outbox)
        .set({ deliveryStatus: status, deliveryStatusAt: event.occurredAt, updatedAt: new Date() })
        .where(
          and(
            eq(outbox.id, message.id),
            sql`${rankOf(sql`${outbox.deliveryStatus}`)} <= ${sql.raw(String(deliveryStatusRank(status)))}`,
          ),
        );

      const studentsMarked = event.kind === "hard_bounce" ? await markStudentEmailInvalid(tx, message.recipient, event) : 0;
      return { kind: "recorded", studentsMarked } as const;
    });
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A hard bounce means the address is dead — the safety net for a mistyped
 * e-mail the checkout's code did not catch (OOC-65). It flags the file whose
 * CURRENT e-mail is the one that bounced: a student who has since corrected the
 * address is not flagged for the old one. Only marks and records — nothing is
 * blocked, deleted or re-sent, and a file already flagged keeps its first date.
 */
async function markStudentEmailInvalid(tx: Tx, recipient: string, event: EmailDeliveryEvent): Promise<number> {
  const marked = await tx
    .update(students)
    // `updated_at` stays: the file reads it as the student's last activity, and a bounce is not one.
    .set({ emailInvalidAt: event.occurredAt })
    .where(
      and(
        sql`lower(${students.email}) = lower(${recipient})`,
        isNull(students.deletedAt),
        isNull(students.emailInvalidAt),
      ),
    )
    .returning({ id: students.id });

  if (marked.length > 0) {
    // Names the reason code, never the address (`audit_log` keeps what
    // changed, not the value — CLAUDE.md §8).
    await tx.insert(auditLog).values(
      marked.map((student) => ({
        actorId: BREVO_AUDIT_ACTOR,
        action: "student.email_marked_invalid",
        targetId: student.id,
        metadata: { reason: event.reason },
      })),
    );
  }
  return marked.length;
}
