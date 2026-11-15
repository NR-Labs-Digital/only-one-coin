import { sql, type SQL } from "drizzle-orm";
import { enrollmentModuleId, outerEntryModuleId } from "./classGroupModuleSql.js";

/**
 * The name of the teacher allocated to a module run (OOC-80, OOC-156), read
 * from the roster — so a corrected teacher file shows everywhere at once — or
 * else the free text typed before teachers had a file (the run's
 * `teacher_name`, copied by 0058). Empty when nobody is allocated. A
 * correlated subquery instead of a join, so each reader keeps its own joins.
 * Its own aliases, so nothing inside binds to the outer row by accident
 * (`classGroupModuleSql.ts`).
 */
export function moduleTeacherName(classGroupModuleId: SQL): SQL<string> {
  return sql<string>`coalesce((
    select coalesce(named_teacher.first_name || ' ' || named_teacher.last_name, nullif(named_run.teacher_name, ''))
    from "class_group_modules" named_run
    left join "teachers" named_teacher on named_teacher.id = named_run.teacher_id
    where named_run.id = ${classGroupModuleId}
  ), '')`;
}

/** The teacher of the run an enrollment is in now — what the ledger and the student's portal print. */
export const enrollmentTeacherName = moduleTeacherName(enrollmentModuleId());

/** The teacher of the outer class group's entry run — the one a new student would meet. */
export const entryTeacherName = moduleTeacherName(outerEntryModuleId());
