import { academicPeriods, classGroupModules, classGroups, courses, enrollments, teachers, waitlistEntries } from "@ooc/db";
import { classroomLinksOf, isMissingClassroom, type ClassGroupStatus, type ClassroomLink, type WeeklySlot } from "@ooc/domain";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { enrollmentModuleId, MODULE_ORDER } from "./classGroupModuleSql.js";
import { pendingTeacherClassGroup } from "./pendingTeacherClassGroup.js";

/** One module run of a class group (OOC-156) — the "sub-turma": its own teacher, schedule and Classroom. */
export interface ClassGroupModuleItem {
  id: string;
  /** Which of the course's modules it teaches, 1-based; null = not set, or a full course. */
  module: number | null;
  fullCourse: boolean;
  /** The teacher allocated from the roster (OOC-80); null = nobody yet. */
  teacherId: string | null;
  /** The allocated teacher's name, from their file; empty when unallocated. */
  teacherName: string;
  /**
   * The free text typed before teachers had a file — only a hint for the
   * coordination while the run waits for a real allocation.
   */
  legacyTeacherName: string;
  slots: WeeklySlot[];
  /** The one link pasted before OOC-144 — read-only, shown only while no module is set. */
  classroomUrl: string | null;
  /** Every module's stored Classroom (OOC-144), module number → link — what the form edits. */
  classroomLinksByModule: Record<string, string>;
  /** The links of the modules it teaches, in order (`classroomLinksOf`) — what the calendar opens. */
  classroomLinks: ClassroomLink[];
  /** Some module it teaches has no Classroom yet (`isMissingClassroom`). */
  classroomMissing: boolean;
  /** Its Google Meet (OOC-159); null = nobody pasted one yet. */
  meetUrl: string | null;
  /** Confirmed seats in this run now. */
  students: number;
}

export interface ClassGroupItem {
  id: string;
  code: string;
  courseId: string;
  courseName: string;
  language: string;
  /** The course is not retired — a class group of a retired course still lists, flagged. */
  courseActive: boolean;
  academicPeriodId: string;
  academicPeriodName: string;
  /**
   * Every live module run, in module order (OOC-156). The class group's first
   * run — where a new student starts — is `modules[0]`; the teaching fields
   * below repeat it, so a screen about a class group of one run reads them as
   * it always did. Anything about a teacher's runs reads `modules`.
   */
  modules: ClassGroupModuleItem[];
  /** The first run's teacher (OOC-80); null = nobody yet. */
  teacherId: string | null;
  /** The allocated teacher's name, from their file; empty when unallocated. */
  teacherName: string;
  /**
   * The free text typed before teachers had a file — only a hint for the
   * coordination while the class group waits for a real allocation.
   */
  legacyTeacherName: string;
  /**
   * The one link pasted before OOC-144 — read-only, shown only while no module
   * is set, so the form can carry it onto the module coordination picks.
   */
  classroomUrl: string | null;
  /** Every module's stored Classroom (OOC-144), module number → link — what the form edits. */
  classroomLinksByModule: Record<string, string>;
  /** The links of the modules it teaches, in order (`classroomLinksOf`) — what the calendar opens. */
  classroomLinks: ClassroomLink[];
  /** Some run of the class group is missing a Classroom — the "Sin Classroom" warning. */
  classroomMissing: boolean;
  /** The first run's Meet (OOC-159) — what the form of a one-run class group edits. */
  meetUrl: string | null;
  /** Some run of the class group has no teacher yet. */
  teacherMissing: boolean;
  /** Which of the course's modules the first run teaches (OOC-100), 1-based; null = not set. */
  module: number | null;
  fullCourse: boolean;
  slots: WeeklySlot[];
  /** ISO 8601, UTC — rendered in America/Lima by the screen. */
  startsOn: string | null;
  endsOn: string | null;
  enrollmentOpensAt: string | null;
  enrollmentClosesAt: string | null;
  capacity: number;
  seatsTaken: number;
  /** Seats held above capacity (OOC-155) — the "+2" of "30/30 +2". */
  seatsOver: number;
  status: ClassGroupStatus;
  /** Not retired. */
  active: boolean;
  /** People still waiting (left_at is null). */
  waitlistCount: number;
}

export interface ClassGroupFilter {
  periodId?: string;
  courseId?: string;
  status?: ClassGroupStatus;
  /** Free text over code, course name and teacher name. */
  q?: string;
  id?: string;
  /** The class groups where one teacher runs some module (OOC-78, OOC-156). */
  teacherId?: string;
  /** Only the class groups with some run nobody is allocated to yet (OOC-80). */
  unassigned?: boolean;
  /** Only the class groups whose seats closed with no teacher yet, every period (OOC-97). */
  pendingTeacher?: boolean;
}

/** Without a period or a search the list would be every class group ever opened. */
const UNSCOPED_LIMIT = 500;

/** `%`, `_` and the escape character itself are literal in what a person types. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * The backoffice class group list — retired ones included, flagged. Read-only
 * shaping, so it lives beside the repository and not in the domain.
 */
export class ListClassGroupsQuery {
  constructor(private readonly db: Db) {}

  async run(filter: ClassGroupFilter): Promise<ClassGroupItem[]> {
    const term = filter.q?.trim();
    const conditions: (SQL | undefined)[] = [
      filter.id ? eq(classGroups.id, filter.id) : undefined,
      filter.periodId ? eq(classGroups.academicPeriodId, filter.periodId) : undefined,
      filter.courseId ? eq(classGroups.courseId, filter.courseId) : undefined,
      filter.teacherId ? hasRun(eq(classGroupModules.teacherId, filter.teacherId)) : undefined,
      filter.status ? eq(classGroups.status, filter.status) : undefined,
      filter.unassigned ? hasRun(isNull(classGroupModules.teacherId)) : undefined,
      filter.pendingTeacher ? pendingTeacherClassGroup() : undefined,
      term
        ? or(
            ilike(classGroups.code, `%${escapeLike(term)}%`),
            ilike(courses.name, `%${escapeLike(term)}%`),
            hasRun(
              or(
                sql`exists (
                  select 1 from ${teachers}
                  where ${teachers.id} = ${classGroupModules.teacherId}
                    and (${teachers.firstName} || ' ' || ${teachers.lastName}) ilike ${`%${escapeLike(term)}%`}
                )`,
                ilike(classGroupModules.teacherName, `%${escapeLike(term)}%`),
              )!,
            ),
          )
        : undefined,
    ];
    // The pending list is a to-do list across every period: capping it would
    // hide exactly the oldest class groups, the ones most overdue.
    const unscoped = !filter.id && !filter.periodId && !filter.teacherId && !filter.pendingTeacher && !term;

    const waitlistCount = sql<number>`(
      select count(*) from ${waitlistEntries}
      where ${waitlistEntries.classGroupId} = ${classGroups.id} and ${waitlistEntries.leftAt} is null
    )`.mapWith(Number);

    const query = this.db
      .select({
        row: classGroups,
        courseName: courses.name,
        language: courses.language,
        courseDeletedAt: courses.deletedAt,
        courseModules: courses.modules,
        periodName: academicPeriods.name,
        waitlistCount,
      })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .where(and(...conditions));

    const rows = await (unscoped
      ? query.orderBy(desc(classGroups.createdAt), desc(classGroups.id)).limit(UNSCOPED_LIMIT)
      : query.orderBy(
          asc(courses.language),
          asc(courses.name),
          sql`${classGroups.startsOn} asc nulls last`,
          asc(classGroups.code),
          asc(classGroups.id),
        ));

    const runs = await this.modulesOf(
      rows.map(({ row }) => row.id),
      new Map(rows.map(({ row, courseModules }) => [row.id, courseModules])),
    );

    return rows.map(({ row, courseName, language, courseDeletedAt, periodName, waitlistCount: waiting }) => {
      const modules = runs.get(row.id) ?? [];
      const first = modules[0];
      return {
      id: row.id,
      code: row.code,
      courseId: row.courseId,
      courseName,
      language,
      courseActive: courseDeletedAt === null,
      academicPeriodId: row.academicPeriodId,
      academicPeriodName: periodName,
      modules,
      teacherId: first?.teacherId ?? null,
      teacherName: first?.teacherName ?? "",
      legacyTeacherName: first?.legacyTeacherName ?? "",
      classroomUrl: first?.classroomUrl ?? null,
      classroomLinksByModule: first?.classroomLinksByModule ?? {},
      classroomLinks: first?.classroomLinks ?? [],
      classroomMissing: modules.some((run) => run.classroomMissing),
      meetUrl: first?.meetUrl ?? null,
      teacherMissing: modules.some((run) => run.teacherId === null),
      module: first?.module ?? null,
      fullCourse: first?.fullCourse ?? false,
      slots: first?.slots ?? [],
      startsOn: row.startsOn?.toISOString() ?? null,
      endsOn: row.endsOn?.toISOString() ?? null,
      enrollmentOpensAt: row.enrollmentOpensAt?.toISOString() ?? null,
      enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
      capacity: row.capacity,
      seatsTaken: row.seatsTaken,
      seatsOver: row.seatsOver,
      status: row.status as ClassGroupStatus,
      active: row.deletedAt === null,
      waitlistCount: waiting,
      };
    });
  }

  /** The live runs of these class groups, in module order, with their teacher and how many are in each. */
  private async modulesOf(
    classGroupIds: string[],
    courseModulesOf: Map<string, number>,
  ): Promise<Map<string, ClassGroupModuleItem[]>> {
    const byGroup = new Map<string, ClassGroupModuleItem[]>();
    if (classGroupIds.length === 0) return byGroup;

    const students = this.db
      .select({ classGroupModuleId: enrollmentModuleId().as("class_group_module_id"), total: sql<number>`count(*)::int`.as("total") })
      .from(enrollments)
      .where(
        and(
          inArray(enrollments.classGroupId, classGroupIds),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .groupBy(enrollmentModuleId())
      .as("run_students");

    const rows = await this.db
      .select({
        run: classGroupModules,
        teacherName: sql<string>`coalesce(${teachers.firstName} || ' ' || ${teachers.lastName}, '')`,
        students: sql<number>`coalesce(${students.total}, 0)`.mapWith(Number),
      })
      .from(classGroupModules)
      .leftJoin(teachers, eq(teachers.id, classGroupModules.teacherId))
      .leftJoin(students, eq(students.classGroupModuleId, classGroupModules.id))
      .where(and(inArray(classGroupModules.classGroupId, classGroupIds), isNull(classGroupModules.deletedAt)))
      .orderBy(asc(classGroupModules.classGroupId), ...MODULE_ORDER);

    for (const { run, teacherName, students: seated } of rows) {
      const courseModules = courseModulesOf.get(run.classGroupId) ?? 0;
      const item: ClassGroupModuleItem = {
        id: run.id,
        module: run.module,
        fullCourse: run.fullCourse,
        teacherId: run.teacherId,
        teacherName,
        legacyTeacherName: run.teacherName,
        slots: run.slots as WeeklySlot[],
        classroomUrl: run.classroomUrl,
        classroomLinksByModule: run.classroomLinks,
        classroomLinks: classroomLinksOf(run, courseModules),
        classroomMissing: isMissingClassroom(run, courseModules),
        meetUrl: run.meetUrl,
        students: seated,
      };
      byGroup.set(run.classGroupId, [...(byGroup.get(run.classGroupId) ?? []), item]);
    }
    return byGroup;
  }
}

/** Some live run of the class group satisfies `where`. */
function hasRun(where: SQL): SQL {
  return sql`exists (
    select 1 from ${classGroupModules}
    where ${classGroupModules.classGroupId} = ${classGroups.id}
      and ${classGroupModules.deletedAt} is null
      and ${where}
  )`;
}
