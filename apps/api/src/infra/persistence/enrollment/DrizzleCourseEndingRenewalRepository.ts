import type { EmailNotification, EndingEnrollment, ICourseEndingRenewalRepository } from "@ooc/domain";
import { classGroups, enrollments, outbox } from "@ooc/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEnrollmentEmailContextLookup } from "./DrizzleEnrollmentEmailContextLookup.js";

/**
 * What the renewal tick reads and writes (OOC-53). The end is the class
 * group's `ends_on` read as a Lima calendar day, the way the screens type and
 * show it.
 */
export class DrizzleCourseEndingRenewalRepository implements ICourseEndingRenewalRepository {
  private readonly contexts: DrizzleEnrollmentEmailContextLookup;

  constructor(private readonly db: Db) {
    this.contexts = new DrizzleEnrollmentEmailContextLookup(db);
  }

  async listEndingOn(endsOnDay: string): Promise<EndingEnrollment[]> {
    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
        endsOn: classGroups.endsOn,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(
        and(
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
          isNull(classGroups.deletedAt),
          inArray(classGroups.status, ["enrolling", "in_progress"]),
          sql`(${classGroups.endsOn} at time zone 'America/Lima')::date = ${endsOnDay}::date`,
        ),
      );
    // `ends_on` is never null on a class group that is not a draft (OOC-35).
    return rows.flatMap((row) => (row.endsOn ? [{ ...row, endsOn: row.endsOn }] : []));
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
