import {
  assertReceivable,
  EnrollmentTransferConflictError,
  type IEnrollmentTransferRepository,
  type TransferDestination,
  type TransferSource,
} from "@ooc/domain";
import { auditLog, classGroups, courses, enrollments, guardians, planPrices, plans, students } from "@ooc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Any grade on the enrollment, in any module run or attempt — a grade is the person's. */
const gradedSql = sql<boolean>`exists (select 1 from "grades" g where g.enrollment_id = "enrollments"."id")`;

/** A paid procedure still open on the enrollment (OOC-83) — it was asked in the holder's name. */
const procedureOpenSql = sql<boolean>`exists (
  select 1 from "procedure_requests" pr
   where pr.enrollment_id = "enrollments"."id" and pr.status in ('requested', 'paid')
)`;

/**
 * Handing an enrollment to another person (OOC-105). Only `student_id` moves:
 * the seat, the class group and the counters stay where they are, so nothing
 * here touches a seat counter.
 */
export class DrizzleEnrollmentTransferRepository implements IEnrollmentTransferRepository {
  constructor(private readonly db: Db) {}

  async findSource(enrollmentId: string): Promise<TransferSource | null> {
    const [row] = await this.db
      .select({
        id: enrollments.id,
        studentId: enrollments.studentId,
        seatStatus: enrollments.seatStatus,
        classGroupId: enrollments.classGroupId,
        classGroupStatus: classGroups.status,
        courseId: plans.courseId,
        courseAllowsEnrollmentTransfer: courses.allowsEnrollmentTransfer,
        courseMinAge: courses.minAge,
        graded: gradedSql,
        procedureOpen: procedureOpenSql,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      // The course is the plan's: the enrollment's price says what it bought.
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .innerJoin(courses, eq(courses.id, plans.courseId))
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findDestination(studentId: string, courseId: string): Promise<TransferDestination | null> {
    return destinationOf(this.db, studentId, courseId);
  }

  async transfer(params: Parameters<IEnrollmentTransferRepository["transfer"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // The enrollment first, then the destination — always in this order,
      // so two transfers never wait on each other crosswise.
      const [current] = await tx
        .select({ id: enrollments.id, graded: gradedSql, procedureOpen: procedureOpenSql })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.id, params.enrollmentId),
            eq(enrollments.studentId, params.fromStudentId),
            eq(enrollments.seatStatus, "confirmed"),
            isNull(enrollments.deletedAt),
          ),
        )
        .for("update");
      // A grade or a procedure landing meanwhile is a change like any other.
      if (!current || current.graded || current.procedureOpen) throw new EnrollmentTransferConflictError();

      // Locking the destination's row makes two transfers onto the same
      // person queue here, and the second sees the first's seat below.
      const [locked] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, params.toStudentId), isNull(students.deletedAt)))
        .for("update");
      if (!locked) throw new EnrollmentTransferConflictError();
      const destination = await destinationOf(tx, params.toStudentId, params.courseId);
      if (!destination) throw new EnrollmentTransferConflictError();
      // The same refusal the use case gave, now under the lock — a seat in
      // the course that appeared meanwhile is refused as such.
      assertReceivable(destination, 0);

      await tx
        .update(enrollments)
        .set({ studentId: params.toStudentId, updatedAt: sql`now()` })
        .where(eq(enrollments.id, params.enrollmentId));

      await tx.insert(auditLog).values({
        actorId: params.audit.actorId,
        action: params.audit.action,
        targetId: params.enrollmentId,
        metadata: params.audit.metadata,
        createdAt: params.audit.at,
      });
    });
  }
}

// Qualified by hand: in a one-table select Drizzle writes `students.id` as a
// bare "id", which inside the subquery would bind to the inner table
// (apps/api CLAUDE.md, "Armadilha do Drizzle").
async function destinationOf(db: Db | Tx, studentId: string, courseId: string): Promise<TransferDestination | null> {
  const [row] = await db
    .select({
      id: students.id,
      birthDate: students.birthDate,
      hasLiveGuardian: sql<boolean>`exists (
        select 1 from ${guardians} gd where gd.student_id = "students"."id" and gd.deleted_at is null
      )`,
      // Reserved, confirmed or frozen: a seat the person still holds in the course.
      enrolledInCourse: sql<boolean>`exists (
        select 1 from "enrollments" e
          join "plan_prices" pp on pp.id = e.plan_price_id
          join "plans" p on p.id = pp.plan_id
         where e.student_id = "students"."id"
           and e.deleted_at is null
           and e.seat_status <> 'released'
           and p.course_id = ${courseId}
      )`,
    })
    .from(students)
    .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
    .limit(1);
  return row ?? null;
}
