import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, students } from "@ooc/db";
import type { PaymentMethod } from "@ooc/domain";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * The payment ledger — every payment the institution has received, read for
 * the Payments screen of the backoffice (OOC-55). Read-only, and outside
 * `packages/domain` for the same reason as `ListEnrollmentsQuery`: it protects
 * no invariant, it only shapes a join.
 *
 * Since OOC-55 the enrollment ledger lists only seats that got in; whatever is
 * still open or was refused is settled here, so this read is the one place a
 * payment in any state can be found.
 */

/** One screen of rows, the same size as the enrollment ledger. Offset paging,
 * for the same reasons given there. */
export const PAYMENTS_PAGE_SIZE = 15;

export type PaymentListStatus = "pending" | "under_review" | "approved" | "rejected";

/**
 * What the reader narrowed the ledger to. Absent means "all", and every
 * field is applied by Postgres — at peak volume (CLAUDE.md §1) a filter over a
 * page slice answers the wrong question.
 */
export interface PaymentListFilters {
  status?: PaymentListStatus;
  method?: PaymentMethod;
  academicPeriodId?: string;
  /** Free text: student name, course or operation number. */
  q?: string;
  sort?: "newest" | "oldest";
  /** 1-based. */
  page?: number;
}

export interface PaymentListRow {
  id: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  courseName: string;
  status: PaymentListStatus;
  method: PaymentMethod;
  methodDetail: string | null;
  operationNumber: string | null;
  /** What the student says they paid. */
  amountCents: number;
  /** The plan price the enrollment was sold at — the value the payment is
   * checked against (no discounts, ever: CLAUDE.md §1). */
  expectedAmountCents: number;
  currency: "PEN";
  submittedAt: Date;
  /** `payments.decided_at` (OOC-112), not `payments.updated_at`: the row's
   * timestamp moves for reasons other than the decision. */
  decidedAt: Date | null;
  decidedByName: string | null;
}

export interface PaymentListMetrics {
  periodName: string;
  inReview: number;
  oldestOpenHours: number | null;
  approved: number;
  collectedCents: number;
  rejected: number;
}

export interface PaymentListResult {
  items: PaymentListRow[];
  /** Payments matching the filters, across every page. */
  total: number;
  page: number;
  pageSize: number;
  /** Counted over the current period, never over the filtered page — the
   * header describes the ciclo, not the reader's current search. */
  metrics: PaymentListMetrics;
}

/** A payment nobody has decided yet — what the review queue lists. */
export const OPEN_STATUSES: ("pending" | "under_review")[] = ["pending", "under_review"];

/**
 * The free-text search both Payments reads share: student name, course and
 * operation number. The student is searched by full name so "Ana Quispe"
 * finds the row and not only "Ana".
 */
export function paymentSearchCondition(q: string | undefined): SQL | undefined {
  const needle = q?.trim();
  if (!needle) return undefined;
  const pattern = `%${needle}%`;
  return or(
    ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, pattern),
    ilike(courses.name, pattern),
    ilike(payments.operationNumber, pattern),
  );
}

export class ListPaymentsQuery {
  constructor(private readonly db: Db) {}

  async run(filters: PaymentListFilters = {}): Promise<PaymentListResult> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));

    const where = and(
      // A retired enrollment takes its payments out of the ledger with it;
      // a retired course or class group does not — they still label the
      // money that was paid on them.
      isNull(enrollments.deletedAt),
      ...this.filterConditions(filters),
    );

    const rowsPromise = this.db
      .select({
        id: payments.id,
        enrollmentId: payments.enrollmentId,
        status: payments.status,
        method: payments.method,
        methodDetail: payments.methodDetail,
        operationNumber: payments.operationNumber,
        amountCents: payments.amountCents,
        createdAt: payments.createdAt,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        courseName: courses.name,
        expectedAmountCents: planPrices.amountCents,
        decidedAt: payments.decidedAt,
        // "user" is Better Auth's table, not modelled in the Drizzle schema —
        // raw SQL, as in DrizzleStaffUserLookup. A payment decided outside the
        // panel (seed, legacy import) has no reviewer and reads as no name.
        decidedByName: sql<string | null>`(select "name" from "user" where "id" = ${payments.decidedBy})`,
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .where(where)
      .orderBy(
        ...(filters.sort === "oldest"
          ? [asc(payments.createdAt), asc(payments.id)]
          : [desc(payments.createdAt), desc(payments.id)]),
      )
      .limit(PAYMENTS_PAGE_SIZE)
      .offset((page - 1) * PAYMENTS_PAGE_SIZE);

    // Only the joins a filter can reach. Each follows a NOT NULL foreign key,
    // so none of them changes the count.
    const totalPromise = this.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(where);

    const [rows, counted, metrics] = await Promise.all([rowsPromise, totalPromise, this.metrics()]);

    const items = rows.map(
      (row): PaymentListRow => ({
        id: row.id,
        enrollmentId: row.enrollmentId,
        studentId: row.studentId,
        studentName: `${row.firstName} ${row.lastName}`,
        courseName: row.courseName,
        // Both columns are held to these unions by CHECK constraints
        // (payments_status_check, payments_method_check).
        status: row.status as PaymentListStatus,
        method: row.method as PaymentMethod,
        methodDetail: row.methodDetail,
        operationNumber: row.operationNumber,
        amountCents: row.amountCents,
        expectedAmountCents: row.expectedAmountCents,
        currency: "PEN",
        submittedAt: row.createdAt,
        decidedAt: row.decidedAt,
        decidedByName: row.decidedByName,
      }),
    );

    return {
      items,
      total: counted[0]?.value ?? 0,
      page,
      pageSize: PAYMENTS_PAGE_SIZE,
      metrics,
    };
  }

  private filterConditions(filters: PaymentListFilters): SQL[] {
    const conditions: SQL[] = [];

    if (filters.status) conditions.push(eq(payments.status, filters.status));
    if (filters.method) conditions.push(eq(payments.method, filters.method));
    if (filters.academicPeriodId) conditions.push(eq(classGroups.academicPeriodId, filters.academicPeriodId));

    const search = paymentSearchCondition(filters.q);
    if (search) conditions.push(search);

    return conditions;
  }

  /**
   * The header figures, counted by Postgres over the current period: the
   * most recent one already started and not retired, the same rule as the
   * enrollment ledger's header. No current period means nothing to count.
   */
  private async metrics(): Promise<PaymentListMetrics> {
    const [period] = await this.db
      .select({ id: academicPeriods.id, name: academicPeriods.name })
      .from(academicPeriods)
      .where(and(sql`${academicPeriods.startsOn} <= now()`, isNull(academicPeriods.deletedAt)))
      .orderBy(desc(academicPeriods.startsOn))
      .limit(1);

    if (!period) {
      return { periodName: "", inReview: 0, oldestOpenHours: null, approved: 0, collectedCents: 0, rejected: 0 };
    }

    const open = inArray(payments.status, OPEN_STATUSES);
    const [totals] = await this.db
      .select({
        inReview: sql<number>`count(*) filter (where ${open})`.mapWith(Number),
        // Raw aggregate, not mapped through the column: the driver may hand
        // back a string, so it is parsed below either way.
        oldestOpenAt: sql<Date | string | null>`min(${payments.createdAt}) filter (where ${open})`,
        approved: sql<number>`count(*) filter (where ${payments.status} = 'approved')`.mapWith(Number),
        collectedCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'approved'), 0)`.mapWith(
          Number,
        ),
        rejected: sql<number>`count(*) filter (where ${payments.status} = 'rejected')`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(isNull(enrollments.deletedAt), eq(classGroups.academicPeriodId, period.id)));

    const oldestOpenAt = totals?.oldestOpenAt ?? null;

    return {
      periodName: period.name,
      inReview: totals?.inReview ?? 0,
      oldestOpenHours:
        oldestOpenAt === null ? null : Math.floor((Date.now() - new Date(oldestOpenAt).getTime()) / 3_600_000),
      approved: totals?.approved ?? 0,
      collectedCents: totals?.collectedCents ?? 0,
      rejected: totals?.rejected ?? 0,
    };
  }
}
