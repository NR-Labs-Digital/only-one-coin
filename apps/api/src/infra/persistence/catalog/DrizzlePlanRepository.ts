import { Plan, type IPlanRepository, type PlanPrice } from "@ooc/domain";
import { planPrices, plans } from "@ooc/db";
import { eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export class DrizzlePlanRepository implements IPlanRepository {
  constructor(private readonly db: Db) {}

  async createWithPrice(plan: Plan, price: PlanPrice): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(plans).values({ id: plan.id, courseId: plan.courseId, name: plan.name, billing: plan.billing });
      await tx.insert(planPrices).values({
        id: price.id,
        planId: price.planId,
        amountCents: price.amountCents,
        validFrom: price.validFrom,
      });
    });
  }

  async findById(id: string): Promise<Plan | null> {
    const [row] = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return row
      ? new Plan({
          id: row.id,
          courseId: row.courseId,
          name: row.name,
          billing: row.billing === "monthly" ? "monthly" : "package",
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        })
      : null;
  }

  async rename(plan: Plan): Promise<void> {
    await this.db.update(plans).set({ name: plan.name, updatedAt: plan.updatedAt }).where(eq(plans.id, plan.id));
  }

  /** INSERT only — the 0017 trigger refuses anything else on this table. */
  async addPrice(price: PlanPrice): Promise<void> {
    await this.db.insert(planPrices).values({
      id: price.id,
      planId: price.planId,
      amountCents: price.amountCents,
      validFrom: price.validFrom,
    });
  }
}
