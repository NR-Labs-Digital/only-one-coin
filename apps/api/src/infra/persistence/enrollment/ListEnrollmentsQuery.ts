import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { classGroupTeacherName } from "@/infra/persistence/catalog/classGroupTeacherName.js";

/**
 * The enrollment ledger — every confirmed seat in the institution, read for the
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
}

export type EnrollmentListSeatStatus = "reserved" | "confirmed" | "released";

/**
 * What the reader narrowed the ledger to. Every field is optional — absent
 * means "all" — and all of them are applied by Postgres, never by the browser
 * over a slice: at 20k enrollments a month in peak season (CLAUDE.md §1) a
 * filter that only sees the newest few hundred rows answers the wrong question.
 */
export interface EnrollmentListFilters {
  /** `courses.language` — the label itself, there is no languages table. */
  language?: string;
  academicPeriodId?: string;
  /** Free text: tracking code, student, course, class group, teacher or
   * operation number. */
  q?: string;
  sort?: "newest" | "oldest";
  /** 1-based. */
  page?: number;
}

export interface EnrollmentListFilterOptions {
  languages: string[];
  periods: { id: string; name: string }[];
}

export interface EnrollmentListResult {
  items: EnrollmentListRow[];
  /** Enrollments matching the filters, across every page. */
  total: number;
  page: number;
  pageSize: number;
  /** Counted over the whole ledger, never over the filtered page — the header
   * figures describe the ciclo, not the reader's current search. */
  metrics: EnrollmentListMetrics;
  /** What the filter panel may offer, read from the catalog rather than from
   * the rows on screen — a language nobody on this page bought is still one
   * the ledger holds. */
  filterOptions: EnrollmentListFilterOptions;
}

/**
 * One screen of rows (`enrollments-view.tsx` shows exactly this many). Paged
 * by offset rather than cursor: the reader jumps to page 40 of a filtered
 * ledger and sorts both ways, and at this table's size an offset costs a sort
 * Postgres already does for the ORDER BY.
 */
const PAGE_SIZE = 15;

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
 * `trackingCode` rebuilt in SQL, so a search for the code a student reads out
 * on the phone finds the row without the ledger being loaded into memory. The
 * two must agree character for character — the integration test pins that.
 */
const trackingCodeSql = sql<string>`'OOC-' || to_char(${enrollments.createdAt} at time zone 'UTC', 'YYYY') || '-' || lpad(right(regexp_replace(${enrollments.id}::text, '\\D', '', 'g'), 4), 4, '0')`;

/**
 * What the row means to a reader, out of the two states that are actually
 * stored. `completed` is in the union the screen filters by, but nothing in
 * the schema can produce it yet — there is no grading, so no enrollment is
 * ever finished. It stays unreachable rather than faked.
 */
export function deriveStatus(seatStatus: string, paymentStatus: string): EnrollmentListStatus {
  if (paymentStatus === "rejected" || seatStatus === "released") return "rejected";
  if (seatStatus === "confirmed" && paymentStatus === "approved") return "active";
  return "under_review";
}

export class ListEnrollmentsQuery {
  constructor(private readonly db: Db) {}

  async run(filters: EnrollmentListFilters = {}): Promise<EnrollmentListResult> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));

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

    const where = and(
      // Only the enrollment itself is filtered for retirement: a retired
      // course or class group must still label the enrollments that happened
      // on it, or the ledger would lose rows every time the catalog is tidied
      // up.
      isNull(enrollments.deletedAt),
      // OOC-55: the ledger is who got in. A seat still reserved (payment open)
      // or already handed back (payment refused) is settled in Payments and
      // never reaches this list. The seat decides, not the latest payment: a
      // monthly student whose next module is still open is still a student.
      eq(enrollments.seatStatus, "confirmed"),
      ...this.filterConditions(filters, latestPayment),
    );

    const rowsPromise = this.db
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
        teacherName: classGroupTeacherName,
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
      .where(where)
      .orderBy(
        ...(filters.sort === "oldest"
          ? [asc(enrollments.createdAt), asc(enrollments.id)]
          : [desc(enrollments.createdAt), desc(enrollments.id)]),
      )
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    // Same joins as the page wherever a filter can reach them — every inner
    // join here follows a NOT NULL foreign key, so none of them changes the
    // count, and the ones no filter reads (period name, plan) are left out.
    const totalPromise = this.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .leftJoin(latestPayment, eq(latestPayment.enrollmentId, enrollments.id))
      .where(where);

    const [rows, counted, metrics, filterOptions] = await Promise.all([
      rowsPromise,
      totalPromise,
      this.metrics(),
      this.filterOptions(),
    ]);

    const items = rows.map((row): EnrollmentListRow => {
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

    return {
      items,
      total: counted[0]?.value ?? 0,
      page,
      pageSize: PAGE_SIZE,
      metrics,
      filterOptions,
    };
  }

  /**
   * The reader's filters as WHERE conditions. `latestPayment` columns come in
   * as parameters because the subquery is built per call.
   */
  private filterConditions(
    filters: EnrollmentListFilters,
    latestPayment: { status: SQLWrapper; operationNumber: SQLWrapper },
  ): SQL[] {
    const conditions: SQL[] = [];

    if (filters.language) conditions.push(eq(courses.language, filters.language));
    if (filters.academicPeriodId) conditions.push(eq(classGroups.academicPeriodId, filters.academicPeriodId));

    const q = filters.q?.trim();
    if (q) {
      const needle = `%${q}%`;
      conditions.push(
        or(
          ilike(trackingCodeSql, needle),
          ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, needle),
          ilike(courses.name, needle),
          ilike(classGroups.code, needle),
          ilike(classGroups.schedule, needle),
          ilike(classGroupTeacherName, needle),
          ilike(sql`${latestPayment.operationNumber}`, needle),
        )!,
      );
    }

    return conditions;
  }

  /**
   * Every language and period the ledger can hold, retired ones included — an
   * enrollment on a retired course still lists, so the filter has to be able
   * to reach it.
   */
  private async filterOptions(): Promise<EnrollmentListFilterOptions> {
    const [languageRows, periods] = await Promise.all([
      this.db.selectDistinct({ language: courses.language }).from(courses).orderBy(asc(courses.language)),
      this.db
        .select({ id: academicPeriods.id, name: academicPeriods.name })
        .from(academicPeriods)
        .orderBy(desc(academicPeriods.startsOn)),
    ]);

    return { languages: languageRows.map((row) => row.language), periods };
  }

  /**
   * The header figures, counted by Postgres over the whole ledger. Doing it in
   * JS over `items` would make every number quietly mean "of this page",
   * which is the kind of figure somebody reports upward.
   */
  private async metrics(): Promise<EnrollmentListMetrics> {
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
      })
      .from(enrollments)
      .leftJoin(latestPaymentStatus, eq(latestPaymentStatus.enrollmentId, enrollments.id))
      .where(and(isNull(enrollments.deletedAt), eq(enrollments.seatStatus, "confirmed")));

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
    };
  }
}

export { PAGE_SIZE };
