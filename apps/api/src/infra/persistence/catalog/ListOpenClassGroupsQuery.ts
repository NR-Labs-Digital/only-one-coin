import { academicPeriods, classGroups, courses, planPrices, plans } from "@ooc/db";
import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface OpenClassGroupResult {
  id: string;
  courseId: string;
  courseName: string;
  academicPeriodName: string;
  schedule: string;
  startsOn: string;
  capacity: number;
  seatsTaken: number;
  status: string;
  planId: string;
  planName: string;
  planPriceId: string;
  amountCents: number;
}

/**
 * Read-only listing for the manual enrollment form's class group picker —
 * outside packages/domain for the same reason as SearchStudentsQuery: no
 * invariant to protect, only a join to shape. Filters server-side to
 * `status = 'enrolling' AND seats_taken < capacity` (defense in depth — the
 * client filters too, but the server is the one that must not lie about
 * what has room).
 *
 * One plan per course, matching apps/app/.../new-enrollment-form.tsx's
 * existing assumption (it already picks "the" plan for a course, not a
 * list). Documented simplification, not a business rule: a course with more
 * than one plan (Plano Básico vs Completo) only ever surfaces its most
 * recently created plan and that plan's current price here.
 */
export class ListOpenClassGroupsQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<OpenClassGroupResult[]> {
    const rows = await this.db
      .select({
        id: classGroups.id,
        courseId: classGroups.courseId,
        courseName: courses.name,
        academicPeriodName: academicPeriods.name,
        schedule: classGroups.schedule,
        startsOn: classGroups.startsOn,
        capacity: classGroups.capacity,
        seatsTaken: classGroups.seatsTaken,
        status: classGroups.status,
        planId: plans.id,
        planName: plans.name,
        planPriceId: planPrices.id,
        amountCents: planPrices.amountCents,
      })
      .from(classGroups)
      .innerJoin(courses, eq(classGroups.courseId, courses.id))
      .innerJoin(academicPeriods, eq(classGroups.academicPeriodId, academicPeriods.id))
      .innerJoin(plans, eq(plans.courseId, courses.id))
      .innerJoin(planPrices, and(eq(planPrices.planId, plans.id), lte(planPrices.validFrom, sql`now()`)))
      // Every table joined here is part of the offer being listed, so a
      // retired row on any of them takes the class group out (CLAUDE.md §6).
      .where(
        and(
          eq(classGroups.status, "enrolling"),
          gt(classGroups.capacity, classGroups.seatsTaken),
          isNull(classGroups.deletedAt),
          isNull(courses.deletedAt),
          isNull(academicPeriods.deletedAt),
          isNull(plans.deletedAt),
        ),
      )
      .orderBy(asc(courses.name), desc(plans.createdAt), desc(planPrices.validFrom));

    // The joins above can produce more than one row per class_group when a
    // course has multiple plans or a plan has price history — ordering puts
    // the freshest plan/price first, so the first row seen per id wins.
    const seen = new Set<string>();
    const result: OpenClassGroupResult[] = [];

    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({ ...row, startsOn: row.startsOn.toISOString() });
    }

    return result;
  }
}
