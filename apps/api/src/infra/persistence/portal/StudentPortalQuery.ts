import {
  academicPeriods,
  classGroupModules,
  classGroups,
  courses,
  enrollments,
  currentGrades,
  paymentCoverage,
  payments,
  platformSettings,
  planPrices,
  plans,
  procedurePrices,
  procedureRequests,
  receiptUploads,
  students,
} from "@ooc/db";
import {
  classroomLinksOf,
  PROCEDURE_KINDS,
  type ClassroomLink,
  type ProcedureKind,
  type ProcedureRequestStatus,
} from "@ooc/domain";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { deriveStatus, trackingCode, type EnrollmentListStatus } from "../enrollment/ListEnrollmentsQuery.js";
import type { GetStudentQuery, StudentDetailRow } from "../student/GetStudentQuery.js";
import { enrollmentTeacherName } from "@/infra/persistence/catalog/classGroupTeacherName.js";
import { enrollmentModuleId } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { pickProfile, profilesOfAccount } from "./accountProfiles.js";
import { reachesStudent } from "./reachableStudents.js";

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
    /** One Classroom per module the class group teaches (OOC-144), in order — only on a confirmed seat; empty otherwise. */
    classroomLinks: ClassroomLink[];
  };
  academicPeriodName: string;
  plan: { name: string; priceId: string; priceCents: number };
  /** Every payment of the enrollment, newest first. */
  payments: PortalPaymentRow[];
  /**
   * The final grade the teacher posted in this class group (OOC-38) — final
   * once posted. `score` is null on a DA. Null while nothing is posted.
   */
  finalGrade: { score: number | null; didNotSit: boolean; recordedAt: Date } | null;
}

/** A paid procedure the student can start: today's price, and which of their
 * enrollments may ask for it right now. */
export interface PortalProcedureRow {
  kind: ProcedureKind;
  priceCents: number;
  eligible: { enrollmentId: string; courseName: string }[];
}

/** A procedure the student asked for and paid, or tried to. A request with no
 * payment yet is an abandoned form, and not listed. */
export interface PortalProcedureRequestRow {
  id: string;
  kind: ProcedureKind;
  status: ProcedureRequestStatus;
  courseName: string;
  amountCents: number;
  createdAt: Date;
  payment: PortalPaymentRow;
}

export interface PortalOverview {
  /** The profile shown, and every profile of the account (OOC-147). */
  profileId: string;
  profiles: { id: string; firstName: string; lastName: string }[];
  student: StudentDetailRow;
  /** `platform_settings.passing_grade` (OOC-41): the screen compares the grade with it, never with a constant. */
  passingGrade: number | null;
  enrollments: PortalEnrollmentRow[];
  procedures: PortalProcedureRow[];
  requests: PortalProcedureRequestRow[];
}

/**
 * What the signed-in account sees of one of its profiles (OOC-32, OOC-147),
 * scoped by the account id the session carries — never by an id from the
 * client (CLAUDE.md §8). The profile the client names only picks among the
 * account's own (`pickProfile`).
 *
 * `students.user_id` is not unique: a guardian's children, and two files of
 * the same person (the same document, still not consolidated — CLAUDE.md §1),
 * point at one account. The identity is the profile's newest file; the
 * enrollments are every file of that person, because a payment approved on
 * the older file is still the person's course.
 */
export class StudentPortalQuery {
  constructor(
    private readonly db: Db,
    private readonly getStudent: GetStudentQuery,
  ) {}

  async overview(userId: string, requestedProfileId: string | null = null): Promise<PortalOverview | null> {
    const profiles = await profilesOfAccount(this.db, userId);
    const profile = pickProfile(profiles, requestedProfileId);
    if (!profile) return null;

    const student = await this.getStudent.run(profile.id);
    if (!student) return null;

    const fileIds = profile.fileIds;
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
        // The run the student is in now (OOC-156): its teacher, its week,
        // its Classroom. Dates and code are the class group's.
        teacherName: enrollmentTeacherName,
        slots: classGroupModules.slots,
        startsOn: classGroups.startsOn,
        endsOn: classGroups.endsOn,
        classroomUrl: classGroupModules.classroomUrl,
        classroomLinks: classGroupModules.classroomLinks,
        classGroupModule: classGroupModules.module,
        classGroupFullCourse: classGroupModules.fullCourse,
        courseModules: courses.modules,
        academicPeriodName: academicPeriods.name,
        planName: plans.name,
        planPriceId: planPrices.id,
        planPriceCents: planPrices.amountCents,
        gradeScore: currentGrades.score,
        gradeDidNotSit: currentGrades.didNotSit,
        gradeRecordedAt: currentGrades.recordedAt,
      })
      .from(enrollments)
      // A retired course or class group still labels the enrollment that
      // happened on it — only the enrollment itself is filtered.
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      // A retired run still labels the seat that was in it.
      .innerJoin(classGroupModules, eq(classGroupModules.id, enrollmentModuleId()))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      // The latest grade of the seat — the posted one or its last correction
      // (OOC-38, OOC-102). One per module run and attempt since OOC-156: the
      // newest is what the student last heard about, and it stays on screen
      // after they move on to the next module, until that one is graded.
      .leftJoin(
        currentGrades,
        and(
          eq(currentGrades.enrollmentId, enrollments.id),
          eq(currentGrades.classGroupId, enrollments.classGroupId),
          sql`not exists (
            select 1 from "current_grades" newer
            where newer.enrollment_id = "current_grades"."enrollment_id"
              and newer.class_group_id = "current_grades"."class_group_id"
              and (newer.recorded_at, newer.grade_id) > ("current_grades"."recorded_at", "current_grades"."grade_id")
          )`,
        ),
      )
      .where(and(inArray(enrollments.studentId, fileIds), isNull(enrollments.deletedAt)))
      .orderBy(desc(enrollments.createdAt), desc(enrollments.id));

    const [paymentsByEnrollment, prices, requests, settings] = await Promise.all([
      this.paymentsOf(rows.map((row) => row.id)),
      this.currentPrices(),
      this.requestsOf(fileIds),
      this.db.select({ passingGrade: platformSettings.passingGrade }).from(platformSettings).limit(1),
    ]);

    // Blocked by a request that carries money or is paid; one still waiting for
    // its receipt is the same form picked up again.
    const live = new Set(
      requests.filter((request) => request.status === "requested" || request.status === "paid").map((request) => `${request.kind}:${request.enrollmentId}`),
    );
    const procedures = prices.map(({ kind, priceCents }): PortalProcedureRow => ({
      kind,
      priceCents,
      eligible: rows
        .filter((row) => row.seatStatus === "confirmed" && !live.has(`${kind}:${row.id}`))
        .map((row) => ({ enrollmentId: row.id, courseName: row.courseName })),
    }));

    return {
      profileId: profile.id,
      profiles: profiles.map(({ id, firstName, lastName }) => ({ id, firstName, lastName })),
      student,
      passingGrade: settings[0]?.passingGrade ?? null,
      procedures,
      requests: requests.map(({ enrollmentId: _enrollmentId, ...request }) => request),
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
            // a reserved or released seat never sees a link (OOC-98, OOC-144).
            classroomLinks:
              row.seatStatus === "confirmed"
                ? classroomLinksOf(
                    {
                      module: row.classGroupModule,
                      fullCourse: row.classGroupFullCourse,
                      classroomLinks: row.classroomLinks,
                      classroomUrl: row.classroomUrl,
                    },
                    row.courseModules,
                  )
                : [],
          },
          academicPeriodName: row.academicPeriodName,
          plan: { name: row.planName, priceId: row.planPriceId, priceCents: row.planPriceCents },
          payments: enrollmentPayments,
          finalGrade:
            row.gradeRecordedAt !== null
              ? {
                  score: row.gradeDidNotSit ? null : Number(row.gradeScore),
                  didNotSit: row.gradeDidNotSit === true,
                  recordedAt: row.gradeRecordedAt,
                }
              : null,
        };
      }),
    };
  }

  /**
   * Whether the payment hangs off an enrollment of a file this account
   * reaches — any profile, the guardian's children included (OOC-147). The receipt route answers 404 otherwise — the same answer as a
   * payment that does not exist, so an id from someone else reveals nothing.
   */
  async ownsPayment(userId: string, paymentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .leftJoin(procedureRequests, eq(procedureRequests.id, payments.procedureRequestId))
      // Any enrollment the payment pays for (OOC-158): the second child of a
      // lot opens the receipt that paid for their seat too.
      .leftJoin(paymentCoverage, eq(paymentCoverage.paymentId, payments.id))
      .innerJoin(enrollments, eq(enrollments.id, sql`coalesce(${paymentCoverage.enrollmentId}, ${procedureRequests.enrollmentId})`))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(payments.id, paymentId),
          reachesStudent(userId),
          isNull(enrollments.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async currentPrices(): Promise<{ kind: ProcedureKind; priceCents: number }[]> {
    const rows = await this.db
      .selectDistinctOn([procedurePrices.kind], { kind: procedurePrices.kind, priceCents: procedurePrices.amountCents })
      .from(procedurePrices)
      .where(and(inArray(procedurePrices.kind, [...PROCEDURE_KINDS]), lte(procedurePrices.validFrom, sql`now()`)))
      .orderBy(procedurePrices.kind, desc(procedurePrices.validFrom), desc(procedurePrices.id));
    return rows.map((row) => ({ kind: row.kind as ProcedureKind, priceCents: row.priceCents }));
  }

  /** Inner join on the payment: a request is only a request to the student once
   * the receipt went in. */
  private async requestsOf(fileIds: string[]): Promise<(PortalProcedureRequestRow & { enrollmentId: string })[]> {
    const rows = await this.db
      .select({
        id: procedureRequests.id,
        kind: procedureRequests.kind,
        status: procedureRequests.status,
        enrollmentId: procedureRequests.enrollmentId,
        amountCents: procedureRequests.amountCents,
        createdAt: procedureRequests.createdAt,
        courseName: courses.name,
        paymentId: payments.id,
        paymentMethod: payments.method,
        paymentMethodDetail: payments.methodDetail,
        paymentStatus: payments.status,
        operationNumber: payments.operationNumber,
        submittedAt: payments.createdAt,
        decidedAt: payments.decidedAt,
        hasReceipt: sql<boolean>`exists (
          select 1 from ${receiptUploads}
          where ${receiptUploads.paymentId} = ${payments.id}
            and ${receiptUploads.processedObjectKey} is not null
        )`,
      })
      .from(procedureRequests)
      .innerJoin(payments, eq(payments.procedureRequestId, procedureRequests.id))
      .innerJoin(enrollments, eq(enrollments.id, procedureRequests.enrollmentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(inArray(procedureRequests.studentId, fileIds))
      .orderBy(desc(procedureRequests.createdAt), desc(procedureRequests.id));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as ProcedureKind,
      status: row.status as ProcedureRequestStatus,
      enrollmentId: row.enrollmentId,
      courseName: row.courseName,
      amountCents: row.amountCents,
      createdAt: row.createdAt,
      payment: {
        id: row.paymentId,
        amountCents: row.amountCents,
        method: row.paymentMethod,
        methodDetail: row.paymentMethodDetail,
        status: row.paymentStatus,
        operationNumber: row.operationNumber,
        submittedAt: row.submittedAt,
        settledAt: row.decidedAt,
        hasReceipt: row.hasReceipt,
      },
    }));
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
        enrollmentId: paymentCoverage.enrollmentId,
        amountCents: payments.amountCents,
        method: payments.method,
        methodDetail: payments.methodDetail,
        status: payments.status,
        operationNumber: payments.operationNumber,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
        hasReceipt,
      })
      // Every enrollment a payment pays for (OOC-158): a lot's payment is
      // listed under each of its enrollments, with the amount of the whole
      // receipt — which is what was paid.
      .from(paymentCoverage)
      .innerJoin(payments, eq(payments.id, paymentCoverage.paymentId))
      .where(inArray(paymentCoverage.enrollmentId, enrollmentIds))
      .orderBy(desc(payments.createdAt), desc(payments.id));

    for (const row of rows) {
      const enrollmentId = row.enrollmentId;
      const list = byEnrollment.get(enrollmentId) ?? [];
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
      byEnrollment.set(enrollmentId, list);
    }
    return byEnrollment;
  }
}
