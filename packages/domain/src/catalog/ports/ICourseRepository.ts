import type { Course } from "../Course.js";
import type { Plan, PlanPrice } from "../Plan.js";
import type { LandingCourseKey } from "../landingCourseKeys.js";

/**
 * No delete: a course leaves the catalog through RetireCatalogEntryUseCase
 * (deleted_at), never physically (CLAUDE.md §6). `findById` answers retired
 * rows too — the caller decides whether a retired course is acceptable.
 */
export interface ICourseRepository {
  create(course: Course): Promise<Course>;
  /**
   * A course and its plans, each with its first price, in one transaction
   * (OOC-182, duplicating a course): a copy that stopped halfway would be a
   * course on the shelf with only some of its plans.
   */
  createWithPlans(course: Course, plans: readonly { plan: Plan; price: PlanPrice }[]): Promise<Course>;
  findById(id: string): Promise<Course | null>;
  update(course: Course): Promise<Course>;
  /** The live course linked to that landing page, if any — retired ones let go of it. */
  findLiveByLandingKey(key: LandingCourseKey): Promise<Course | null>;
}
