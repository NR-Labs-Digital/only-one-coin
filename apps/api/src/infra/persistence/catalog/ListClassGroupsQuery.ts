import { academicPeriods, classGroups, courses, waitlistEntries } from "@ooc/db";
import type { ClassGroupStatus, WeeklySlot } from "@ooc/domain";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { linkedTeacherName } from "./classGroupTeacherName.js";

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
  /** The teacher allocated from the roster (OOC-80); null = nobody yet. */
  teacherId: string | null;
  /** The allocated teacher's name, from their file; empty when unallocated. */
  teacherName: string;
  /**
   * The free text typed before teachers had a file — only a hint for the
   * coordination while the class group waits for a real allocation.
   */
  legacyTeacherName: string;
  /** The Google Classroom coordination pasted (OOC-98); null = nobody yet. */
  classroomUrl: string | null;
  /** Which of the course's modules it teaches (OOC-100), 1-based; null = not set. */
  module: number | null;
  slots: WeeklySlot[];
  /** ISO 8601, UTC — rendered in America/Lima by the screen. */
  startsOn: string | null;
  endsOn: string | null;
  enrollmentOpensAt: string | null;
  enrollmentClosesAt: string | null;
  capacity: number;
  seatsTaken: number;
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
  /** The class groups allocated to one teacher (OOC-78). */
  teacherId?: string;
  /** Only the class groups nobody is allocated to yet (OOC-80). */
  unassigned?: boolean;
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
      filter.teacherId ? eq(classGroups.teacherId, filter.teacherId) : undefined,
      filter.status ? eq(classGroups.status, filter.status) : undefined,
      filter.unassigned ? isNull(classGroups.teacherId) : undefined,
      term
        ? or(
            ilike(classGroups.code, `%${escapeLike(term)}%`),
            ilike(courses.name, `%${escapeLike(term)}%`),
            ilike(linkedTeacherName, `%${escapeLike(term)}%`),
            ilike(classGroups.teacherName, `%${escapeLike(term)}%`),
          )
        : undefined,
    ];
    const unscoped = !filter.id && !filter.periodId && !filter.teacherId && !term;

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
        periodName: academicPeriods.name,
        teacherName: linkedTeacherName,
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

    return rows.map(({ row, courseName, language, courseDeletedAt, periodName, teacherName, waitlistCount: waiting }) => ({
      id: row.id,
      code: row.code,
      courseId: row.courseId,
      courseName,
      language,
      courseActive: courseDeletedAt === null,
      academicPeriodId: row.academicPeriodId,
      academicPeriodName: periodName,
      teacherId: row.teacherId,
      teacherName,
      legacyTeacherName: row.teacherName,
      classroomUrl: row.classroomUrl,
      module: row.module,
      slots: row.slots as WeeklySlot[],
      startsOn: row.startsOn?.toISOString() ?? null,
      endsOn: row.endsOn?.toISOString() ?? null,
      enrollmentOpensAt: row.enrollmentOpensAt?.toISOString() ?? null,
      enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
      capacity: row.capacity,
      seatsTaken: row.seatsTaken,
      status: row.status as ClassGroupStatus,
      active: row.deletedAt === null,
      waitlistCount: waiting,
    }));
  }
}
