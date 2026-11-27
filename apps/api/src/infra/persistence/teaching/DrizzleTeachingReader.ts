import { academicPeriods, classGroupModules, classGroups, courses, enrollments, students } from "@ooc/db";
import {
  classroomLinksOf,
  materialOfModule,
  type ClassGroupStatus,
  type GradingClassGroup,
  type ITeachingReader,
  type TeachingClassGroup,
  type TeachingStudent,
  type WeeklySlot,
} from "@ooc/domain";
import { and, asc, count, eq, isNull, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import type { ClassGroupRosterQuery } from "../catalog/ClassGroupRosterQuery.js";
import { enrollmentInModule, enrollmentInModules } from "../catalog/classGroupModuleSql.js";

/**
 * The docente portal's reads (OOC-82). It answers what it is asked and
 * decides nothing — whose module run it is and whether it is still in the
 * portal is the usecase's check (`teachingScope.ts`). What a teacher teaches
 * is a module run of a class group (OOC-156): the teaching fields are the
 * run's, the rest the class group's.
 */
export class DrizzleTeachingReader implements ITeachingReader {
  constructor(
    private readonly db: Db,
    private readonly roster: ClassGroupRosterQuery,
  ) {}

  listClassGroupsOf(teacherId: string): Promise<TeachingClassGroup[]> {
    return this.select(eq(classGroupModules.teacherId, teacherId));
  }

  async findClassGroup(classGroupModuleId: string): Promise<TeachingClassGroup | null> {
    const [group] = await this.select(eq(classGroupModules.id, classGroupModuleId));
    return group ?? null;
  }

  /**
   * Confirmed seats in the run now, surname order — the names only: the
   * document and the contact never leave this adapter.
   */
  async listStudents(classGroupModuleId: string): Promise<TeachingStudent[]> {
    return this.db
      .select({ enrollmentId: enrollments.id, firstName: students.firstName, lastName: students.lastName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          enrollmentInModule(classGroupModuleId),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));
  }

  async countStudents(classGroupModuleIds: string[]): Promise<number> {
    if (classGroupModuleIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: count() })
      .from(enrollments)
      .where(
        and(
          enrollmentInModules(classGroupModuleIds),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      );
    return row?.total ?? 0;
  }

  async findGradingClassGroup(classGroupId: string): Promise<GradingClassGroup | null> {
    const [row] = await this.db
      .select({ id: classGroups.id, status: classGroups.status })
      .from(classGroups)
      .where(eq(classGroups.id, classGroupId));
    return row ? { id: row.id, status: row.status as ClassGroupStatus } : null;
  }

  /** The roster of OOC-71 — every confirmed seat of the class group, across its runs — narrowed to the names. */
  async listClassGroupStudents(classGroupId: string): Promise<TeachingStudent[]> {
    const rows = await this.roster.run(classGroupId);
    return (rows ?? []).map((row) => ({
      enrollmentId: row.enrollmentId,
      firstName: row.firstName,
      lastName: row.lastName,
    }));
  }

  private async select(where: SQL): Promise<TeachingClassGroup[]> {
    const rows = await this.db
      .select({
        run: classGroupModules,
        group: classGroups,
        courseName: courses.name,
        language: courses.language,
        moduleMaterials: courses.moduleMaterials,
        courseModules: courses.modules,
        periodName: academicPeriods.name,
      })
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .where(where)
      .orderBy(
        asc(courses.language),
        asc(courses.name),
        asc(classGroups.code),
        asc(classGroupModules.module),
        asc(classGroupModules.id),
      );

    return rows.map(({ run, group, courseName, language, moduleMaterials, courseModules, periodName }) => ({
      id: run.id,
      classGroupId: group.id,
      teacherId: run.teacherId,
      code: group.code,
      courseName,
      language,
      academicPeriodName: periodName,
      slots: run.slots as WeeklySlot[],
      startsOn: group.startsOn,
      endsOn: group.endsOn,
      capacity: group.capacity,
      seatsTaken: group.seatsTaken,
      status: group.status as ClassGroupStatus,
      classroomLinks: classroomLinksOf(run, courseModules),
      meetUrl: run.meetUrl,
      module: run.module,
      moduleMaterialUrl: materialOfModule(moduleMaterials, run.module),
      fullCourse: run.fullCourse,
      courseMaterialUrls: moduleMaterials,
      retired: group.deletedAt !== null || run.deletedAt !== null,
    }));
  }
}
