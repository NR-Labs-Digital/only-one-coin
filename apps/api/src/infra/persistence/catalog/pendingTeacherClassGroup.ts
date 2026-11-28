import { classGroupModules, classGroups } from "@ooc/db";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { classGroupIsFull } from "./seatCounters.js";

/**
 * What "this class group closed its seats and still has nobody to teach it"
 * means, written once (OOC-97). Coordination assigns teachers after enrollment
 * closes, so the Académico section lists these as its to-do list:
 *
 * - not retired, and some live module run (OOC-156) with no teacher from the
 *   roster yet;
 * - enrolling or in progress — a draft never opened, and a finished or closed
 *   class group is past the point where a teacher can be found for it;
 * - somebody holds a seat — a class group nobody bought is not an offer that
 *   needs a teacher;
 * - and its seats are closed: it is in progress, it is full, or its
 *   enrollment window has ended.
 *
 * Computed on read, never stored: the class group joins the list the moment
 * one of those turns true and leaves it the moment its last run gets a
 * teacher. A retired course or period does not take it off — the students who
 * already hold a seat still need a teacher.
 */
export function pendingTeacherClassGroup(now: SQL = sql`now()`): SQL {
  return and(
    isNull(classGroups.deletedAt),
    // A demo class group (28/11/2026) is nobody's pending work.
    eq(classGroups.isDemo, false),
    sql`exists (
      select 1 from ${classGroupModules}
      where ${classGroupModules.classGroupId} = ${classGroups.id}
        and ${classGroupModules.deletedAt} is null
        and ${classGroupModules.teacherId} is null
    )`,
    inArray(classGroups.status, ["enrolling", "in_progress"]),
    sql`${classGroups.seatsTaken} + ${classGroups.seatsOver} > 0`,
    or(
      eq(classGroups.status, "in_progress"),
      classGroupIsFull(),
      and(isNotNull(classGroups.enrollmentClosesAt), lte(classGroups.enrollmentClosesAt, now)),
    ),
  )!;
}
