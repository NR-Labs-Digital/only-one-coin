import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, receiptUploads, students } from "@ooc/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { deriveStatus, trackingCode, type EnrollmentListStatus } from "../enrollment/ListEnrollmentsQuery.js";
import type { GetStudentQuery, StudentDetailRow } from "../student/GetStudentQuery.js";
import { classGroupTeacherName } from "@/infra/persistence/catalog/classGroupTeacherName.js";

export interface PortalPaymentRow {
  id: string;
  amountCents: number;
  method: string;
  methodDetail: string | null;
  status: string;
  operationNumber: string | null;
  /** When the payment was written — the receipt went in with it. */
  submittedAt: Date;
  /** When a person approved or rejected it; null while it waits. */
  settledAt: Date | null;
  /** A processed receipt exists, so the student can open it again. */
  hasReceipt: boolean;
}

export interface PortalEnrollmentRow {
  id: string;
  code: string;
  status: EnrollmentListStatus;
  seatStatus: string;
  createdAt: Date;
  course: { name: string; summary: string; level: string; minAge: number; requiresCertificationExam: boolean };
  classGroup: {
    name: string;
    teacherName: string;
    slots: unknown;
    startsOn: Date | null;
    endsOn: Date | null;
    /** Only on a confirmed seat (OOC-98); null otherwise. */
    classroomUrl: string | null;
  };
  academicPeriodName: string;
  plan: { name: string; priceId: string; priceCents: number };
  /** Every payment of the enrollment, newest first. */
  payments: PortalPaymentRow[];
}

export interface PortalOverview {
  student: StudentDetailRow;
  enrollments: PortalEnrollmentRow[];
}

/**
 * What the signed-in student sees of themself (OOC-32), scoped by the account
 * id the session carries — never by an id from the client (CLAUDE.md §8).
 *
 * `students.user_id` is not unique: two files of the same person (the same
 * document, still not consolidated — CLAUDE.md §1) point at one account. The
 * identity is the newest file, as `GET /portal/me` reads it; the enrollments
 * are every file's, because a payment approved on the older file is still the
 * person's course.
 */
export class StudentPortalQuery {
  constructor(
    private readonly db: Db,
    private readonly getStudent: GetStudentQuery,
  ) {}

  async overview(userId: string): Promise<PortalOverview | null> {
    const files = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.userId, userId), isNull(students.deletedAt)))
      .orderBy(desc(students.createdAt));
    if (files.length === 0) return null;

    const student = await this.getStudent.run(files[0]!.id);
    if (!student) return null;

    const fileIds = files.map((file) => file.id);
    const rows = await this.db
      .select({
        id: enrollments.id,
        seatStatus: enrollments.seatStatus,
        createdAt: enrollments.createdAt,
        courseName: courses.name,
        courseSummary: courses.summary,
        courseLevel: courses.level,
        courseMinAge: courses.minAge,
        certificateRule: courses.certificateRule,
        classGroupCode: classGroups.code,
        classGroupSchedule: classGroups.schedule,
        teacherName: classGroupTeacherName,
        slots: classGroups.slots,
        startsOn: classGroups.startsOn,
        endsOn: classGroups.endsOn,
        classroomUrl: classGroups.classroomUrl,
        academicPeriodName: academicPeriods.name,
        planName: plans.name,
        planPriceId: planPrices.id,
        planPriceCents: planPrices.amountCents,
      })
      .from(enrollments)
      // A retired course or class group still labels the enrollment that
      // happened on it — only the enrollment itself is filtered.
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(and(inArray(enrollments.studentId, fileIds), isNull(enrollments.deletedAt)))
      .orderBy(desc(enrollments.createdAt), desc(enrollments.id));

    const paymentsByEnrollment = await this.paymentsOf(rows.map((row) => row.id));

    return {
      student,
      enrollments: rows.map((row): PortalEnrollmentRow => {
        const enrollmentPayments = paymentsByEnrollment.get(row.id) ?? [];
        // Same derivation as the ledger and the student file: the newest
        // payment speaks for the seat (StudentEnrollmentHistoryQuery).
        const latestStatus = enrollmentPayments[0]?.status ?? "pending";
        return {
          id: row.id,
          code: trackingCode(row.id, row.createdAt),
          status: deriveStatus(row.seatStatus, latestStatus),
          seatStatus: row.seatStatus,
          createdAt: row.createdAt,
          course: {
            name: row.courseName,
            summary: row.courseSummary,
            level: row.courseLevel,
            minAge: row.courseMinAge,
            requiresCertificationExam: row.certificateRule === "exam_required",
          },
          classGroup: {
            name: row.classGroupCode || row.classGroupSchedule,
            teacherName: row.teacherName,
            slots: row.slots,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            // The door to the class opens with the money confirmed (OOC-55):
            // a reserved or released seat never sees the link (OOC-98).
            classroomUrl: row.seatStatus === "confirmed" ? row.classroomUrl : null,
          },
          academicPeriodName: row.academicPeriodName,
          plan: { name: row.planName, priceId: row.planPriceId, priceCents: row.planPriceCents },
          payments: enrollmentPayments,
        };
      }),
    };
  }

  /**
   * Whether the payment hangs off an enrollment of a file linked to this
   * account. The receipt route answers 404 otherwise — the same answer as a
   * payment that does not exist, so an id from someone else reveals nothing.
   */
  async ownsPayment(userId: string, paymentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(payments.id, paymentId),
          eq(students.userId, userId),
          isNull(students.deletedAt),
          isNull(enrollments.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async paymentsOf(enrollmentIds: string[]): Promise<Map<string, PortalPaymentRow[]>> {
    const byEnrollment = new Map<string, PortalPaymentRow[]>();
    if (enrollmentIds.length === 0) return byEnrollment;

    // Qualified by hand: inside a single-table select Drizzle renders
    // `payments.id` as a bare "id", which the subquery would resolve to
    // receipt_uploads.id.
    const hasReceipt = sql<boolean>`exists (
      select 1 from ${receiptUploads}
      where ${receiptUploads.paymentId} = "payments"."id"
        and ${receiptUploads.processedObjectKey} is not null
    )`;

    const rows = await this.db
      .select({
        id: payments.id,
        enrollmentId: payments.enrollmentId,
        amountCents: payments.amountCents,
        method: payments.method,
        methodDetail: payments.methodDetail,
        status: payments.status,
        operationNumber: payments.operationNumber,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
        hasReceipt,
      })
      .from(payments)
      .where(inArray(payments.enrollmentId, enrollmentIds))
      .orderBy(desc(payments.createdAt), desc(payments.id));

    for (const row of rows) {
      const list = byEnrollment.get(row.enrollmentId) ?? [];
      list.push({
        id: row.id,
        amountCents: row.amountCents,
        method: row.method,
        methodDetail: row.methodDetail,
        status: row.status,
        operationNumber: row.operationNumber,
        submittedAt: row.createdAt,
        settledAt: row.status === "approved" || row.status === "rejected" ? row.updatedAt : null,
        hasReceipt: row.hasReceipt,
      });
      byEnrollment.set(row.enrollmentId, list);
    }
    return byEnrollment;
  }
}
