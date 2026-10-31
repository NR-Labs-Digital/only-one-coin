import type { FailedDelivery, IEmailDeliveryRepository } from "@ooc/domain";
import { parseDeliveryDedupeKey } from "@ooc/domain";
import { auditLog, guardians, students } from "@ooc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { deliveryStudentIdSql } from "./EmailDeliveryQuery.js";

interface RawDelivery extends Record<string, unknown> {
  id: string;
  template_key: string;
  dedupe_key: string;
  status: FailedDelivery["status"];
  student_id: string | null;
}

/** The resend side of the undelivered e-mails screen (OOC-90). */
export class DrizzleEmailDeliveryRepository implements IEmailDeliveryRepository {
  constructor(private readonly db: Db) {}

  async findDelivery(outboxId: string): Promise<FailedDelivery | null> {
    const result = await this.db.execute<RawDelivery>(sql`
      select o.id, o.template_key, o.dedupe_key, o.status, ${deliveryStudentIdSql} as student_id
        from outbox o
       where o.id = ${outboxId}
    `);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      templateKey: row.template_key,
      dedupeKey: row.dedupe_key,
      status: row.status,
      studentId: row.student_id,
    };
  }

  async resend(params: Parameters<IEmailDeliveryRepository["resend"]>[0]): Promise<{ outboxId: string } | null> {
    const { delivery } = params;

    return this.db.transaction(async (tx) => {
      const address = await this.currentAddress(tx as unknown as Db, delivery);

      // INSERT … SELECT from the failed row, so template, locale and vars are
      // copied in the database and never round-trip through here.
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into outbox (channel, template_key, recipient, locale, vars, dedupe_key)
        select o.channel, o.template_key, coalesce(${address}, o.recipient), o.locale, o.vars, ${params.dedupeKey}
          from outbox o
         where o.id = ${delivery.id} and o.status = 'failed'
        on conflict (dedupe_key) do nothing
        returning id
      `);

      const outboxId = inserted.rows[0]?.id;
      if (!outboxId) return null;

      const entry = params.audit(outboxId);
      await tx.insert(auditLog).values({
        actorId: entry.actorId,
        action: entry.action,
        targetId: entry.targetId,
        metadata: entry.metadata ?? null,
        createdAt: entry.at,
      });

      return { outboxId };
    });
  }

  /** What the file says the recipient's address is today; null when the
   * file is gone, and the failed row's address is kept. */
  private async currentAddress(db: Db, delivery: FailedDelivery): Promise<string | null> {
    if (!delivery.studentId) return null;

    if (parseDeliveryDedupeKey(delivery.dedupeKey).recipientKind === "guardian") {
      const [guardian] = await db
        .select({ email: guardians.email })
        .from(guardians)
        .where(and(eq(guardians.studentId, delivery.studentId), isNull(guardians.deletedAt)));
      return guardian?.email ?? null;
    }

    const [student] = await db
      .select({ email: students.email })
      .from(students)
      .where(and(eq(students.id, delivery.studentId), isNull(students.deletedAt)));
    return student?.email ?? null;
  }
}

