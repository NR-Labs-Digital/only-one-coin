import type { EmailNotification, FrozenForReengagement, IFreezeReengagementRepository } from "@ooc/domain";
import { enrollmentFreezeReturns, enrollmentFreezes, enrollments, outbox } from "@ooc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEnrollmentEmailContextLookup } from "./DrizzleEnrollmentEmailContextLookup.js";

/**
 * What the re-engagement tick reads and writes (OOC-84). Months are counted on
 * the Lima calendar (`age` between the two Lima dates), so "one month" turns
 * on the same day of the next month for whoever reads the e-mail.
 */
export class DrizzleFreezeReengagementRepository implements IFreezeReengagementRepository {
  private readonly contexts: DrizzleEnrollmentEmailContextLookup;

  constructor(private readonly db: Db) {
    this.contexts = new DrizzleEnrollmentEmailContextLookup(db);
  }

  async listLiveFreezes(): Promise<FrozenForReengagement[]> {
    const monthsFrozen = sql<number>`(
      extract(year from age((now() at time zone 'America/Lima')::date, (${enrollmentFreezes.createdAt} at time zone 'America/Lima')::date)) * 12
      + extract(month from age((now() at time zone 'America/Lima')::date, (${enrollmentFreezes.createdAt} at time zone 'America/Lima')::date))
    )`.mapWith(Number);
    return this.db
      .select({
        freezeId: enrollmentFreezes.id,
        studentId: enrollments.studentId,
        classGroupId: enrollmentFreezes.classGroupId,
        monthsFrozen,
      })
      .from(enrollmentFreezes)
      .innerJoin(enrollments, eq(enrollments.id, enrollmentFreezes.enrollmentId))
      .where(
        and(
          eq(enrollments.seatStatus, "frozen"),
          isNull(enrollments.deletedAt),
          sql`${enrollmentFreezes.createdAt} <= now() - interval '1 month' + interval '1 day'`,
          sql`not exists (select 1 from ${enrollmentFreezeReturns} r where r.freeze_id = ${enrollmentFreezes.id})`,
        ),
      );
  }

  findEmailContext(params: { studentId: string; classGroupId: string }) {
    return this.contexts.find(params);
  }

  async queue(emails: EmailNotification[]): Promise<number> {
    const rows = await this.db
      .insert(outbox)
      .values(
        emails.map((email) => ({
          channel: "email",
          templateKey: email.templateKey,
          recipient: email.to,
          locale: email.locale,
          vars: email.vars,
          dedupeKey: email.dedupeKey,
        })),
      )
      .onConflictDoNothing({ target: outbox.dedupeKey })
      .returning({ id: outbox.id });
    return rows.length;
  }
}
