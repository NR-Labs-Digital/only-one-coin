import { classGroups, courses, planPrices, plans } from "@ooc/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { toCourseListItem, type CourseListItem } from "./ListCoursesQuery.js";

export interface PlanPriceItem {
  id: string;
  amountCents: number;
  validFrom: string;
  createdAt: string;
}

export interface PlanDetail {
  id: string;
  name: string;
  /** OOC-86: a monthly plan's price is the price of one module. */
  billing: "package" | "monthly";
  active: boolean;
  /** The price in force now — greatest validFrom not after now. Null when every price is still scheduled. */
  currentPriceId: string | null;
  /** Newest validFrom first: a scheduled price sits on top of the one in force. */
  prices: PlanPriceItem[];
}

export interface CourseDetail {
  course: CourseListItem;
  plans: PlanDetail[];
}

export class GetCourseQuery {
  constructor(private readonly db: Db) {}

  async run(id: string, now: Date = new Date()): Promise<CourseDetail | null> {
    const [course] = await this.db.select().from(courses).where(eq(courses.id, id)).limit(1);
    if (!course) return null;

    const [count] = await this.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(classGroups)
      .where(and(eq(classGroups.courseId, id), isNull(classGroups.deletedAt)));

    const planRows = await this.db.select().from(plans).where(eq(plans.courseId, id)).orderBy(asc(plans.createdAt));
    const priceRows =
      planRows.length === 0
        ? []
        : await this.db
            .select()
            .from(planPrices)
            .where(inArray(planPrices.planId, planRows.map((plan) => plan.id)))
            .orderBy(desc(planPrices.validFrom), desc(planPrices.createdAt));

    const planDetails: PlanDetail[] = planRows.map((plan) => {
      const prices = priceRows.filter((price) => price.planId === plan.id);
      const current = prices.find((price) => price.validFrom.getTime() <= now.getTime());
      return {
        id: plan.id,
        name: plan.name,
        billing: plan.billing === "monthly" ? "monthly" : "package",
        active: plan.deletedAt === null,
        currentPriceId: current?.id ?? null,
        prices: prices.map((price) => ({
          id: price.id,
          amountCents: price.amountCents,
          validFrom: price.validFrom.toISOString(),
          createdAt: price.createdAt.toISOString(),
        })),
      };
    });
    const livePlans = planDetails.filter((plan) => plan.active);

    return {
      course: toCourseListItem(course, {
        classGroupCount: count?.value ?? 0,
        planCount: livePlans.length,
        hasPriceInForce: livePlans.some((plan) => plan.currentPriceId !== null),
      }),
      plans: planDetails,
    };
  }
}
