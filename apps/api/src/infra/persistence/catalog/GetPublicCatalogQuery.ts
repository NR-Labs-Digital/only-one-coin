import { classGroups, courses, planPrices, plans } from "@ooc/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface PublicCatalogCourse {
  id: string;
  language: string;
  name: string;
  level: string;
  minAge: number;
  modules: number;
  totalHours: number;
}

export interface PublicCatalogPlan {
  id: string;
  courseId: string;
  name: string;
  planPriceId: string;
  amountCents: number;
}

export interface PublicCatalogClassGroup {
  id: string;
  courseId: string;
  code: string;
  teacherName: string;
  slots: unknown;
  startsOn: Date;
  endsOn: Date;
  capacity: number;
  seatsTaken: number;
}

export interface PublicCatalog {
  courses: PublicCatalogCourse[];
  plans: PublicCatalogPlan[];
  classGroups: PublicCatalogClassGroup[];
}

/**
 * What `/enrollment` reads before anybody picks anything — no session, no
 * role (public route). Only `status = 'enrolling'` class groups are
 * offered; a full or closed one is never listed, matching the seat model
 * (CLAUDE.md §5).
 *
 * `languages` (`CatalogLanguage[]` on the frontend) is not a query of its
 * own — there is no `languages` table, only `courses.language` text — the
 * route derives the distinct set from the courses this returns.
 *
 * There is no `courses.is_active` — a course is "live" (returned at all) the
 * same way a class group is: it has to have something to actually offer,
 * here at least one plan with a current price AND at least one open class
 * group, checked once both are already queried below rather than a third
 * round trip. A course failing either is a dead end step 1 would otherwise
 * let somebody pick and then have nothing to sell them.
 */
export class GetPublicCatalogQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<PublicCatalog> {
    const courseRows = await this.db
      .select({
        id: courses.id,
        language: courses.language,
        name: courses.name,
        level: courses.level,
        minAge: courses.minAge,
        modules: courses.modules,
        totalHours: courses.totalHours,
      })
      // Retired catalog is not offered (CLAUDE.md §6). Filtered on every
      // table this query is *about* — the offer itself — which is all three.
      .from(courses)
      .where(isNull(courses.deletedAt));

    // One row per (plan, current price) — a plan with no price on file
    // (CLAUDE.md §5) is not offered, same as a class group with no seats.
    // Fetched ordered newest-first and deduped in JS by planId, rather than
    // a correlated subquery, to keep "price in force" as the one-line rule
    // it already is in `DrizzlePlanPriceLookup`.
    const allCurrentPrices = await this.db
      .select({
        planId: plans.id,
        courseId: plans.courseId,
        name: plans.name,
        planPriceId: planPrices.id,
        amountCents: planPrices.amountCents,
      })
      .from(plans)
      .innerJoin(planPrices, eq(planPrices.planId, plans.id))
      .where(and(isNull(plans.deletedAt), lte(planPrices.validFrom, sql`now()`)))
      .orderBy(desc(planPrices.validFrom));

    const seenPlanIds = new Set<string>();
    const planRows: PublicCatalogPlan[] = [];
    for (const row of allCurrentPrices) {
      if (seenPlanIds.has(row.planId)) continue;
      seenPlanIds.add(row.planId);
      planRows.push({ id: row.planId, courseId: row.courseId, name: row.name, planPriceId: row.planPriceId, amountCents: row.amountCents });
    }

    const classGroupRows = await this.db
      .select({
        id: classGroups.id,
        courseId: classGroups.courseId,
        code: classGroups.code,
        teacherName: classGroups.teacherName,
        slots: classGroups.slots,
        startsOn: classGroups.startsOn,
        endsOn: classGroups.endsOn,
        capacity: classGroups.capacity,
        seatsTaken: classGroups.seatsTaken,
      })
      .from(classGroups)
      .where(and(eq(classGroups.status, "enrolling"), isNull(classGroups.deletedAt)));

    const courseIdsWithPrice = new Set(planRows.map((plan) => plan.courseId));
    const courseIdsWithOpenGroup = new Set(classGroupRows.map((group) => group.courseId));
    const liveCourseRows = courseRows.filter(
      (course) => courseIdsWithPrice.has(course.id) && courseIdsWithOpenGroup.has(course.id),
    );
    const liveCourseIds = new Set(liveCourseRows.map((course) => course.id));

    return {
      courses: liveCourseRows,
      plans: planRows.filter((plan) => liveCourseIds.has(plan.courseId)),
      classGroups: classGroupRows.filter((group) => liveCourseIds.has(group.courseId)),
    };
  }
}
