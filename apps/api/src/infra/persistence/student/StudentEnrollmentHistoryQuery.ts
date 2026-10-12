import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans } from "@ooc/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { deriveStatus, trackingCode, type EnrollmentListStatus } from "../enrollment/ListEnrollmentsQuery.js";
import { classGroupTeacherName } from "@/infra/persistence/catalog/classGroupTeacherName.js";

export interface StudentEnrollmentHistoryRow {
  id: string;
  code: string;
  status: EnrollmentListStatus;
  seatStatus: string;
  createdAt: Date;
  courseName: string;
  classGroupName: string;
  teacherName: string;
  academicPeriodName: string;
  planName: string;
  planPriceId: string;
  amountCents: number;
  currency: "PEN";
  /** The payment that speaks for the seat now — null when none was ever written. */
  paymentId: string | null;
  paymentStatus: string;
  paymentMethod: string;
  paymentMethodDetail: string | null;
  operationNumber: string | null;
  paidAt: Date | null;
}

/**
 * Every enrollment one person ever opened, for the student file (OOC-73).
 *
 * Deliberately wider than the ledger (`ListEnrollmentsQuery`): the ledger is
 * who got in, so it lists confirmed seats only (OOC-55); the file is the
 * person's history, so a seat still waiting on money and one handed back
 * after a refused payment both belong here — marked, never hidden. Only a
 * retired enrollment is left out (CLAUDE.md §6).
 *
 * Not paged: one person holds a handful of enrollments, not thousands. Same
 * row derivation as the ledger (status, tracking code, latest payment) so the
 * two screens never describe the same enrollment two different ways.
 */
export class StudentEnrollmentHistoryQuery {
  constructor(private readonly db: Db) {}

  async run(studentId: string): Promise<StudentEnrollmentHistoryRow[]> {
    // Latest payment per enrollment, scoped to this student's enrollments so
    // the DISTINCT ON never walks the whole payments table.
    const latestPayment = this.db
      .selectDistinctOn([payments.enrollmentId], {
        id: payments.id,
        enrollmentId: payments.enrollmentId,
        status: payments.status,
        method: payments.method,
        methodDetail: payments.methodDetail,
        operationNumber: payments.operationNumber,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .where(eq(enrollments.studentId, studentId))
      .orderBy(payments.enrollmentId, desc(payments.createdAt))
      .as("latest_payment");

    const rows = await this.db
      .select({
        id: enrollments.id,
        seatStatus: enrollments.seatStatus,
        createdAt: enrollments.createdAt,
        courseName: courses.name,
        classGroupSchedule: classGroups.schedule,
        classGroupCode: classGroups.code,
        teacherName: classGroupTeacherName,
        academicPeriodName: academicPeriods.name,
        planName: plans.name,
        planPriceId: planPrices.id,
        amountCents: planPrices.amountCents,
        paymentId: latestPayment.id,
        paymentStatus: latestPayment.status,
        paymentMethod: latestPayment.method,
        paymentMethodDetail: latestPayment.methodDetail,
        operationNumber: latestPayment.operationNumber,
        paymentUpdatedAt: latestPayment.updatedAt,
      })
      .from(enrollments)
      // A retired course or class group still labels the enrollment that
      // happened on it — only the enrollment itself is filtered.
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .leftJoin(latestPayment, eq(latestPayment.enrollmentId, enrollments.id))
      .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.deletedAt)))
      .orderBy(desc(enrollments.createdAt), desc(enrollments.id));

    return rows.map((row): StudentEnrollmentHistoryRow => {
      const paymentStatus = row.paymentStatus ?? "pending";

      return {
        id: row.id,
        code: trackingCode(row.id, row.createdAt),
        status: deriveStatus(row.seatStatus, paymentStatus),
        seatStatus: row.seatStatus,
        createdAt: row.createdAt,
        courseName: row.courseName,
        classGroupName: row.classGroupCode || row.classGroupSchedule,
        teacherName: row.teacherName,
        academicPeriodName: row.academicPeriodName,
        planName: row.planName,
        planPriceId: row.planPriceId,
        amountCents: row.amountCents,
        currency: "PEN",
        paymentId: row.paymentId,
        paymentStatus,
        paymentMethod: row.paymentMethod ?? "other",
        paymentMethodDetail: row.paymentMethodDetail,
        operationNumber: row.operationNumber,
        paidAt: paymentStatus === "approved" ? row.paymentUpdatedAt : null,
      };
    });
  }
}
