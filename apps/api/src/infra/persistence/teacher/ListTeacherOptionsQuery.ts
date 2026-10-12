import { classGroups, teacherAvailability, teacherLanguages, teachers } from "@ooc/db";
import type { WeeklySlot } from "@ooc/domain";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { toHourMinute } from "./DrizzleTeacherRepository.js";

export interface TeacherOption {
  id: string;
  firstName: string;
  lastName: string;
  languages: string[];
  availability: WeeklySlot[];
  /** Class groups still ahead of them (not finished, closed or retired) — what a new allocation can clash with. */
  classGroups: { id: string; code: string; academicPeriodId: string; slots: WeeklySlot[] }[];
}

/**
 * The teacher picker of the class group form (OOC-80): everyone on the roster,
 * with what the form needs to offer only who teaches the course's language and
 * to warn — never block — about a schedule outside their week or on top of
 * another class group. Small by nature (one row per teacher), so no paging.
 */
export class ListTeacherOptionsQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<TeacherOption[]> {
    const roster = await this.db
      .select({ id: teachers.id, firstName: teachers.firstName, lastName: teachers.lastName })
      .from(teachers)
      .where(and(eq(teachers.status, "active"), isNull(teachers.deletedAt)))
      .orderBy(asc(teachers.lastName), asc(teachers.firstName), asc(teachers.id));
    if (roster.length === 0) return [];

    const ids = roster.map((teacher) => teacher.id);

    // One after the other: a caller inside a transaction has a single client.
    const languages = await this.db
      .select({ teacherId: teacherLanguages.teacherId, language: teacherLanguages.language })
      .from(teacherLanguages)
      .where(inArray(teacherLanguages.teacherId, ids))
      .orderBy(asc(teacherLanguages.language));
    const availability = await this.db
      .select({
        teacherId: teacherAvailability.teacherId,
        weekday: teacherAvailability.weekday,
        startTime: teacherAvailability.startTime,
        endTime: teacherAvailability.endTime,
      })
      .from(teacherAvailability)
      .where(inArray(teacherAvailability.teacherId, ids))
      .orderBy(asc(teacherAvailability.weekday), asc(teacherAvailability.startTime));
    const groups = await this.db
      .select({
        teacherId: classGroups.teacherId,
        id: classGroups.id,
        code: classGroups.code,
        academicPeriodId: classGroups.academicPeriodId,
        slots: classGroups.slots,
      })
      .from(classGroups)
      .where(
        and(
          inArray(classGroups.teacherId, ids),
          notInArray(classGroups.status, ["finished", "closed"]),
          isNull(classGroups.deletedAt),
        ),
      )
      .orderBy(asc(classGroups.code), asc(classGroups.id));

    return roster.map((teacher) => ({
      ...teacher,
      languages: languages.filter((row) => row.teacherId === teacher.id).map((row) => row.language),
      availability: availability
        .filter((row) => row.teacherId === teacher.id)
        .map((row) => ({
          weekday: row.weekday as WeeklySlot["weekday"],
          startTime: toHourMinute(row.startTime),
          endTime: toHourMinute(row.endTime),
        })),
      classGroups: groups
        .filter((row) => row.teacherId === teacher.id)
        .map((row) => ({
          id: row.id,
          code: row.code,
          academicPeriodId: row.academicPeriodId,
          slots: row.slots as WeeklySlot[],
        })),
    }));
  }
}
