import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/*
 * Demo rows (28/11/2026, apps/api CLAUDE.md "Contas demo") stay out of every
 * list the team works from. Written against the id column a query already
 * has, never against a join it may not make — a primary-key lookup each.
 */

/** The row's class group is not a demo one. */
export function notDemoClassGroup(classGroupId: AnyColumn | SQL): SQL {
  return sql`not exists (select 1 from "class_groups" demo_cg where demo_cg."id" = ${classGroupId} and demo_cg."is_demo")`;
}

/** The row's student is not a demo one. */
export function notDemoStudent(studentId: AnyColumn | SQL): SQL {
  return sql`not exists (select 1 from "students" demo_s where demo_s."id" = ${studentId} and demo_s."is_demo")`;
}

/** The row's teacher is not a demo one (a null teacher is not a demo one either). */
export function notDemoTeacher(teacherId: AnyColumn | SQL): SQL {
  return sql`not exists (select 1 from "teachers" demo_t where demo_t."id" = ${teacherId} and demo_t."is_demo")`;
}
