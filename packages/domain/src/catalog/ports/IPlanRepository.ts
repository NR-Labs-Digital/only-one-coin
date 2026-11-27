import type { Plan, PlanPrice } from "../Plan.js";

/**
 * There is no `updatePrice` and never will be (CLAUDE.md §5). `createWithPrice`
 * is one operation because a plan without a price cannot be sold and must not
 * exist half-written. `findById` answers retired plans too.
 */
export interface IPlanRepository {
  createWithPrice(plan: Plan, price: PlanPrice): Promise<void>;
  findById(id: string): Promise<Plan | null>;
  /** Every plan of a course, retired ones too — the caller filters. */
  listByCourse(courseId: string): Promise<Plan[]>;
  rename(plan: Plan): Promise<void>;
  addPrice(price: PlanPrice): Promise<void>;
}
