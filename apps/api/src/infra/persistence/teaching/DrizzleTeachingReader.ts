import { academicPeriods, classGroups, courses, enrollments } from "@ooc/db";
import type { ClassGroupStatus, ITeachingReader, TeachingClassGroup, TeachingStudent, WeeklySlot } from "@ooc/domain";
import { and, asc, count, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import type { ClassGroupRosterQuery } from "../catalog/ClassGroupRosterQuery.js";

/**
 * The docente portal's reads (OOC-82). It answers what it is asked and
 * decides nothing — whose class group it is and whether it is still in the
 * portal is the usecase's check (`teachingScope.ts`).
 */
export class DrizzleTeachingReader implements ITeachingReader {
  constructor(
    private readonly db: Db,
    private readonly roster: ClassGroupRosterQuery,
  ) {}

  listClassGroupsOf(teacherId: string): Promise<TeachingClassGroup[]> {
    return this.select(eq(classGroups.teacherId, teacherId));
  }

  async findClassGroup(classGroupId: string): Promise<TeachingClassGroup | null> {
    const [group] = await this.select(eq(classGroups.id, classGroupId));
    return group ?? null;
  }

  /**
   * The roster of OOC-71 — confirmed seats, surname order — narrowed to the
   * names: the document and the contact never leave this adapter.
   */
  async listStudents(classGroupId: string): Promise<TeachingStudent[]> {
    const rows = await this.roster.run(classGroupId);
    return (rows ?? []).map((row) => ({
      enrollmentId: row.enrollmentId,
      firstName: row.firstName,
      lastName: row.lastName,
    }));
  }

  async countStudents(classGroupIds: string[]): Promise<number> {
    if (classGroupIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: count() })
      .from(enrollments)
      .where(
        and(
          inArray(enrollments.classGroupId, classGroupIds),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      );
    return row?.total ?? 0;
  }

  private async select(where: SQL): Promise<TeachingClassGroup[]> {
    const rows = await this.db
      .select({
        row: classGroups,
        courseName: courses.name,
        language: courses.language,
        periodName: academicPeriods.name,
      })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .where(where)
      .orderBy(asc(courses.language), asc(courses.name), asc(classGroups.code), asc(classGroups.id));

    return rows.map(({ row, courseName, language, periodName }) => ({
      id: row.id,
      teacherId: row.teacherId,
      code: row.code,
      courseName,
      language,
      academicPeriodName: periodName,
      slots: row.slots as WeeklySlot[],
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      capacity: row.capacity,
      seatsTaken: row.seatsTaken,
      status: row.status as ClassGroupStatus,
      retired: row.deletedAt !== null,
    }));
  }
}
