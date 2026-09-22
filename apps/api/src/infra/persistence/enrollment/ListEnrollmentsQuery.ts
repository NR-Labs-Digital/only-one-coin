import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * The enrollment ledger — every seat in the institution, read for the
 * backoffice (CLAUDE.md §1). Read-only, and outside `packages/domain` for the
 * same reason as its neighbours in this folder: it protects no invariant, it
 * only shapes a join.
 *
 * Until this query existed the screen read a fixture, so a real enrollment —
 * one the public checkout had written into Postgres minutes earlier — was
 * invisible to coordination. The manual enrollment form wrote to the API and
 * then drew the new row from local state, which is why a reload made it
 * vanish.
 */

export type EnrollmentListStatus = "under_review" | "active" | "completed" | "rejected";

export interface EnrollmentListRow {
  id: string;
  code: string;
  studentId: string;
  studentName: string;
  courseName: string;
  classGroupId: string | null;
  classGroupName: string;
  teacherName: string;
  language: { id: string; name: string } | null;
  modality: "online";
  academicPeriodName: string;
  status: EnrollmentListStatus;
  seatStatus: string;
  planName: string;
  planPriceId: string;
  amountCents: number;
  currency: "PEN";
  paymentStatus: string;
  paymentMethod: string;
  paymentMethodDetail: string | null;
  operationNumber: string | null;
  createdAt: Date;
  paidAt: Date | null;
  progressPct: number | null;
}

export interface EnrollmentListMetrics {
  periodName: string;
  total: number;
  active: number;
  reserved: number;
  expiringSoon: number;
  released: number;
}

export interface EnrollmentListResult {
  items: EnrollmentListRow[];
  /** Counted over the whole ledger, never over the page above — the header
   * figures must not shrink because the list is capped. */
  metrics: EnrollmentListMetrics;
  /** Whether the ledger holds more than `items` carries. */
  truncated: boolean;
}

/**
 * How long a seat may sit `reserved` with an unsettled payment before the cron
 * hands it back (CLAUDE.md §5 — the five-day review window, the second of the
 * two clocks). Mirrored here only to count what is about to expire; the real
 * value belongs in `/backoffice/settings`, which has no table yet, and the
 * cron that acts on it does not exist either. Provisional on purpose: nothing
 * releases a seat on this number today, it only colours a figure in the header.
 */
const RESERVATION_WINDOW_DAYS = 5;
const RESERVATION_WARNING_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The ledger is read whole by the browser — search, filters and paging all run
 * client-side on this array (`enrollments-view.tsx`). That is fine for a ciclo
 * and not fine for the table: peak season writes up to 20k enrollments a month
 * (CLAUDE.md §1). The cap keeps the response bounded until the screen learns
 * to page server-side, the way the student directory already does; `truncated`
 * is what tells it, and the reader, that it is looking at the newest slice.
 */
const MAX_ROWS = 500;

/**
 * The tracking code the student quotes on the phone (`EnrollmentRow.code`).
 * Derived, not stored: `enrollments` has no code column yet, and the manual
 * enrollment form already prints this exact shape client-side. Deriving it in
 * one place server-side is what keeps the two from drifting — when the column
 * arrives, this function is the only thing that has to go.
 */
export function trackingCode(id: string, createdAt: Date): string {
  const digits = id.replace(/\D/g, "").slice(-4).padStart(4, "0");
  return `OOC-${createdAt.getUTCFullYear()}-${digits}`;
}

/**
 * What the row means to a reader, out of the two states that are actually
 * stored. `completed` is in the union the screen filters by, but nothing in
 * the schema can produce it yet — there is no grading, so no enrollment is
 * ever finished. It stays unreachable rather than faked.
 */
function deriveStatus(seatStatus: string, paymentStatus: string): EnrollmentListStatus {
  if (paymentStatus === "rejected" || seatStatus === "released") return "rejected";
  if (seatStatus === "confirmed" && paymentStatus === "approved") return "active";
  return "under_review";
}

export class ListEnrollmentsQuery {
  constructor(private readonly db: Db) {}

  async run(now = new Date()): Promise<EnrollmentListResult> {
    // The payment that speaks for the enrollment: the most recent one. An
    // enrollment carries more than one once the monthly modality writes a
    // receipt per module (CLAUDE.md §1), and the ledger's money column is
    // about where that seat stands now, not about the first instalment.
    const latestPayment = this.db
      .selectDistinctOn([payments.enrollmentId], {
        enrollmentId: payments.enrollmentId,
        status: payments.status,
        method: payments.method,
        methodDetail: payments.methodDetail,
        operationNumber: payments.operationNumber,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .orderBy(payments.enrollmentId, desc(payments.createdAt))
      .as("latest_payment");

    const rows = await this.db
      .select({
        id: enrollments.id,
        seatStatus: enrollments.seatStatus,
        createdAt: enrollments.createdAt,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        courseName: courses.name,
        courseLanguage: courses.language,
        classGroupId: classGroups.id,
        classGroupSchedule: classGroups.schedule,
        classGroupCode: classGroups.code,
        teacherName: classGroups.teacherName,
        academicPeriodName: academicPeriods.name,
        planName: plans.name,
        planPriceId: planPrices.id,
        amountCents: planPrices.amountCents,
        paymentStatus: latestPayment.status,
        paymentMethod: latestPayment.method,
        paymentMethodDetail: latestPayment.methodDetail,
        operationNumber: latestPayment.operationNumber,
        paymentUpdatedAt: latestPayment.updatedAt,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .leftJoin(latestPayment, eq(latestPayment.enrollmentId, enrollments.id))
      // Only the enrollment itself is filtered: a retired course or class
      // group must still label the enrollments that happened on it, or the
      // ledger would lose rows every time the catalog is tidied up.
      .where(isNull(enrollments.deletedAt))
      .orderBy(desc(enrollments.createdAt), desc(enrollments.id))
      .limit(MAX_ROWS + 1);

    const truncated = rows.length > MAX_ROWS;
    const page = truncated ? rows.slice(0, MAX_ROWS) : rows;

    const items = page.map((row): EnrollmentListRow => {
      const paymentStatus = row.paymentStatus ?? "pending";

      return {
        id: row.id,
        code: trackingCode(row.id, row.createdAt),
        studentId: row.studentId,
        studentName: `${row.firstName} ${row.lastName}`,
        courseName: row.courseName,
        classGroupId: row.classGroupId,
        // The roster label a human recognises: the printed code when the class
        // group has one, the schedule otherwise.
        classGroupName: row.classGroupCode || row.classGroupSchedule,
        teacherName: row.teacherName,
        // `courses.language` is the label itself — there is no languages table
        // to carry an id, and the screen only needs a stable key to filter by.
        language: row.courseLanguage
          ? { id: row.courseLanguage.toLowerCase(), name: row.courseLanguage }
          : null,
        // Every class is online (CLAUDE.md §1) — the one value the business
        // rule allows, not a guess at missing data.
        modality: "online",
        academicPeriodName: row.academicPeriodName,
        status: deriveStatus(row.seatStatus, paymentStatus),
        seatStatus: row.seatStatus,
        planName: row.planName,
        planPriceId: row.planPriceId,
        amountCents: row.amountCents,
        currency: "PEN",
        paymentStatus,
        // A seat with no payment row at all is not a rail anybody chose — the
        // screen reads the status, and `pending` is what it says.
        paymentMethod: row.paymentMethod ?? "other",
        paymentMethodDetail: row.paymentMethodDetail,
        operationNumber: row.operationNumber,
        createdAt: row.createdAt,
        // Settled money has a date; anything else does not pretend to.
        paidAt: paymentStatus === "approved" ? row.paymentUpdatedAt : null,
        // No grading anywhere in the schema yet — null is the honest answer,
        // and the screen already renders it as "sem dado".
        progressPct: null,
      };
    });

    return { items, metrics: await this.metrics(now), truncated };
  }

  /**
   * The header figures, counted by Postgres over the whole ledger. Doing it in
   * JS over `items` would make every number quietly mean "of the newest 500",
   * which is the kind of figure somebody reports upward.
   */
  private async metrics(now: Date): Promise<EnrollmentListMetrics> {
    const expiryThreshold = new Date(
      now.getTime() - (RESERVATION_WINDOW_DAYS * 24 - RESERVATION_WARNING_HOURS) * HOUR_MS,
    );

    const latestPaymentStatus = this.db
      .selectDistinctOn([payments.enrollmentId], {
        enrollmentId: payments.enrollmentId,
        status: payments.status,
      })
      .from(payments)
      .orderBy(payments.enrollmentId, desc(payments.createdAt))
      .as("latest_payment_status");

    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        active:
          sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'confirmed' and ${latestPaymentStatus.status} = 'approved')`.mapWith(
            Number,
          ),
        reserved: sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'reserved')`.mapWith(Number),
        // Reserved for longer than the window minus the warning margin: the
        // seats the cron is about to hand back.
        expiringSoon:
          sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'reserved' and ${enrollments.createdAt} <= ${expiryThreshold})`.mapWith(
            Number,
          ),
        released: sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'released')`.mapWith(Number),
      })
      .from(enrollments)
      .leftJoin(latestPaymentStatus, eq(latestPaymentStatus.enrollmentId, enrollments.id))
      .where(isNull(enrollments.deletedAt));

    // The period the institution is in: the most recent one already started.
    const [period] = await this.db
      .select({ name: academicPeriods.name })
      .from(academicPeriods)
      .where(and(sql`${academicPeriods.startsOn} <= now()`, isNull(academicPeriods.deletedAt)))
      .orderBy(desc(academicPeriods.startsOn))
      .limit(1);

    return {
      periodName: period?.name ?? "",
      total: totals?.total ?? 0,
      active: totals?.active ?? 0,
      reserved: totals?.reserved ?? 0,
      expiringSoon: totals?.expiringSoon ?? 0,
      released: totals?.released ?? 0,
    };
  }
}

export { RESERVATION_WINDOW_DAYS, RESERVATION_WARNING_HOURS, MAX_ROWS };
