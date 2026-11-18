import { classGroups, courses, enrollments, paymentLotEnrollments, planPrices, plans, students } from "@ooc/db";
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/*
 * A lot (OOC-158): one payment paying for several enrollments of the public
 * checkout. Payments reads it through its own enrollment like any payment —
 * these are the pieces that add the lot's other enrollments to a row. Written
 * against `"payments"."id"` by hand: they go inside selects that join
 * `payments` with other tables, never a single-table select (the Drizzle trap
 * in apps/api/CLAUDE.md, "Sub-turmas").
 */

/** What the lot's other enrollments are expected to bring in: the sum of
 * their plan prices, 0 for an ordinary payment. Added to the payment's own
 * enrollment's price, it is what the receipt should say. */
export const lotExpectedExtraCents: SQL<number> = sql<number>`coalesce((
  select sum(lot_price.amount_cents)
    from payment_lot_enrollments lot
    join enrollments lot_enrollment on lot_enrollment.id = lot.enrollment_id
    join plan_prices lot_price on lot_price.id = lot_enrollment.plan_price_id
   where lot.payment_id = "payments"."id"
), 0)`;

/** Whether another enrollment of the lot sits above capacity (OOC-155). */
export const lotHasOverCapacity: SQL<boolean> = sql<boolean>`exists (
  select 1
    from payment_lot_enrollments lot
    join enrollments lot_enrollment on lot_enrollment.id = lot.enrollment_id
   where lot.payment_id = "payments"."id" and lot_enrollment.over_capacity
)`;

/** A search for a student or a course matches a lot through any of its
 * enrollments, not only the payment's own. */
export function lotMatches(pattern: string): SQL {
  return sql`exists (
    select 1
      from payment_lot_enrollments lot
      join enrollments lot_enrollment on lot_enrollment.id = lot.enrollment_id
      join students lot_student on lot_student.id = lot_enrollment.student_id
      join class_groups lot_group on lot_group.id = lot_enrollment.class_group_id
      join courses lot_course on lot_course.id = lot_group.course_id
     where lot.payment_id = "payments"."id"
       and (lot_student.first_name || ' ' || lot_student.last_name ilike ${pattern} or lot_course.name ilike ${pattern})
  )`;
}

/** One more enrollment a lot payment pays for, as Payments lists it. */
export interface PaymentLotItem {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  courseName: string;
  /** Same label as the enrollment ledger: the printed code, else the schedule. */
  classGroupName: string;
  planName: string;
  /** The plan price the enrollment was sold at — its share of the receipt. */
  expectedAmountCents: number;
}

/** The lot's other enrollments of each payment, in lot order — no entry for an
 * ordinary payment. One query for the whole page. */
export async function loadPaymentLots(db: Db, paymentIds: string[]): Promise<Map<string, PaymentLotItem[]>> {
  const lots = new Map<string, PaymentLotItem[]>();
  if (paymentIds.length === 0) return lots;

  const rows = await db
    .select({
      paymentId: paymentLotEnrollments.paymentId,
      enrollmentId: enrollments.id,
      studentId: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      courseName: courses.name,
      classGroupCode: classGroups.code,
      classGroupSchedule: classGroups.schedule,
      planName: plans.name,
      expectedAmountCents: planPrices.amountCents,
    })
    .from(paymentLotEnrollments)
    .innerJoin(enrollments, eq(enrollments.id, paymentLotEnrollments.enrollmentId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
    .innerJoin(courses, eq(courses.id, classGroups.courseId))
    .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
    .innerJoin(plans, eq(plans.id, planPrices.planId))
    .where(inArray(paymentLotEnrollments.paymentId, paymentIds))
    .orderBy(asc(paymentLotEnrollments.id));

  for (const row of rows) {
    const list = lots.get(row.paymentId) ?? [];
    list.push({
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      studentName: `${row.firstName} ${row.lastName}`,
      courseName: row.courseName,
      classGroupName: row.classGroupCode || row.classGroupSchedule,
      planName: row.planName,
      expectedAmountCents: row.expectedAmountCents,
    });
    lots.set(row.paymentId, list);
  }
  return lots;
}
