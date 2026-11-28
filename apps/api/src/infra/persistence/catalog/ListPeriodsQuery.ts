import { academicPeriods, classGroups } from "@ooc/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface PeriodListItem {
  id: string;
  name: string;
  /** ISO 8601, UTC — rendered in America/Lima by the screen. */
  startsOn: string;
  endsOn: string;
  /** Not retired. The backoffice lists both. */
  active: boolean;
  /** Class groups opened in it that are not retired themselves. */
  classGroupCount: number;
}

/**
 * The backoffice period list, newest first, retired ones included and
 * flagged. Read-only shaping, so it lives beside the repository (same as
 * ListCoursesQuery).
 */
export class ListPeriodsQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<PeriodListItem[]> {
    const rows = await this.db
      .select({
        row: academicPeriods,
        classGroupCount: sql<number>`count(${classGroups.id})`.mapWith(Number),
      })
      .from(academicPeriods)
      .leftJoin(
        classGroups,
        and(eq(classGroups.academicPeriodId, academicPeriods.id), isNull(classGroups.deletedAt), eq(classGroups.isDemo, false)),
      )
      .groupBy(academicPeriods.id)
      .orderBy(desc(academicPeriods.startsOn), desc(academicPeriods.id));

    return rows.map(({ row, classGroupCount }) => ({
      id: row.id,
      name: row.name,
      startsOn: row.startsOn.toISOString(),
      endsOn: row.endsOn.toISOString(),
      active: row.deletedAt === null,
      classGroupCount,
    }));
  }
}
