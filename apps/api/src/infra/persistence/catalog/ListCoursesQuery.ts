import { classGroups, courses, planPrices, plans } from "@ooc/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { LandingCourseKey } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

export interface CourseListItem {
  id: string;
  name: string;
  language: string;
  level: string;
  summary: string;
  minAge: number;
  modules: number;
  /** One material link per module, in order (OOC-94). Empty on a course that predates it. */
  moduleMaterials: string[];
  /** The course lacks a link for some module — the backoffice flags it, it still sells. */
  missingModuleMaterials: boolean;
  totalHours: number;
  certificateRule: "automatic" | "exam_required";
  allowsFreeze: boolean;
  allowsTransfer: boolean;
  /** The landing page whose enroll button opens the checkout on it (OOC-117). */
  landingKey: LandingCourseKey | null;
  /** Not retired. The backoffice lists both — taking a course off the shelf is reversible. */
  active: boolean;
  /** Class groups opened on it that are not retired themselves. */
  classGroupCount: number;
  /** Plans on it that are not retired. */
  planCount: number;
  /**
   * At least one live plan has a price already in force — the same rule
   * GetPublicCatalogQuery applies. Without it the course never reaches
   * /enrollment, however many class groups are enrolling.
   */
  hasPriceInForce: boolean;
}

export interface CourseCounts {
  classGroupCount: number;
  planCount: number;
  hasPriceInForce: boolean;
}

/**
 * The backoffice course catalog — retired courses included, flagged. Read-only
 * shaping, so it lives beside the repository and not in the domain (same as
 * ListStudentsQuery).
 */
export class ListCoursesQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<CourseListItem[]> {
    const rows = await this.db
      .select({
        row: courses,
        classGroupCount: sql<number>`count(${classGroups.id})`.mapWith(Number),
        // Correlated, not joined: a second join would multiply the class group count.
        planCount: sql<number>`(select count(*) from ${plans} p where p.course_id = ${courses.id} and p.deleted_at is null)`.mapWith(Number),
        hasPriceInForce: sql<boolean>`exists (select 1 from ${plans} p join ${planPrices} pp on pp.plan_id = p.id where p.course_id = ${courses.id} and p.deleted_at is null and pp.valid_from <= now())`,
      })
      .from(courses)
      .leftJoin(classGroups, and(eq(classGroups.courseId, courses.id), isNull(classGroups.deletedAt)))
      .groupBy(courses.id)
      .orderBy(asc(courses.language), asc(courses.name));

    return rows.map(({ row, ...counts }) => toCourseListItem(row, counts));
  }
}

export function toCourseListItem(row: typeof courses.$inferSelect, counts: CourseCounts): CourseListItem {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    level: row.level,
    summary: row.summary,
    minAge: row.minAge,
    modules: row.modules,
    moduleMaterials: row.moduleMaterials,
    missingModuleMaterials: row.moduleMaterials.length !== row.modules,
    totalHours: row.totalHours,
    certificateRule: row.certificateRule as CourseListItem["certificateRule"],
    allowsFreeze: row.allowsFreeze,
    allowsTransfer: row.allowsTransfer,
    landingKey: row.landingKey as LandingCourseKey | null,
    active: row.deletedAt === null,
    ...counts,
  };
}
