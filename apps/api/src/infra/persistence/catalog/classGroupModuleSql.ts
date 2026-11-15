import { classGroupModules, enrollments } from "@ooc/db";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * The SQL every reader of module runs (OOC-156, 0058) shares, so "which run is
 * this seat in" and "where does a new student start" have one answer.
 *
 * The correlated pieces are written with explicit table names and their own
 * aliases on purpose. Drizzle prints the columns of a single-table select
 * unqualified, and an unqualified `"id"` inside a subquery binds to the
 * subquery's own table — the query still runs and answers the wrong thing.
 * `enrollments` and `class_groups` are never aliased by our readers, so their
 * full names are always the outer row.
 */

/**
 * The run an enrollment is in now. Null only on a row written by the code
 * that ran before 0058 — and that row's run is the one 0058 made under the
 * class group's own id, so the fallback is exact, not a guess.
 */
export function enrollmentModuleId(): SQL<string> {
  return sql<string>`coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")`;
}

/**
 * "The seat is in this run now", written so the planner can answer it from
 * the indexes on `class_group_module_id` and `class_group_id` — a `coalesce`
 * in the WHERE would read the whole table.
 */
export function enrollmentInModule(classGroupModuleId: string): SQL {
  return or(
    eq(enrollments.classGroupModuleId, classGroupModuleId),
    and(isNull(enrollments.classGroupModuleId), eq(enrollments.classGroupId, classGroupModuleId)),
  )!;
}

/** The same, over several runs. Never empty: the caller answers an empty list itself. */
export function enrollmentInModules(classGroupModuleIds: string[]): SQL {
  return or(
    inArray(enrollments.classGroupModuleId, classGroupModuleIds),
    and(isNull(enrollments.classGroupModuleId), inArray(enrollments.classGroupId, classGroupModuleIds)),
  )!;
}

/** The order runs are listed and entered in: by module; a run with no number is alone in its class group. */
export const MODULE_ORDER = [
  sql`${classGroupModules.module} asc nulls first`,
  asc(classGroupModules.createdAt),
  asc(classGroupModules.id),
] as const;

/** The outer `class_groups` row, for a correlated subquery. */
const OUTER_CLASS_GROUP = sql`"class_groups"."id"`;

function entryRun(column: "id" | "slots", classGroupId: SQL | string): SQL {
  return sql`(
    select entry_run.${sql.raw(column)} from "class_group_modules" entry_run
    where entry_run.class_group_id = ${classGroupId} and entry_run.deleted_at is null
    order by entry_run.module asc nulls first, entry_run.created_at asc, entry_run.id asc
    limit 1
  )`;
}

/**
 * The run a new student starts in (OOC-156, owner's decision: always module
 * 1): the class group's lowest live run — module 1 whenever it has one. Same
 * rule as `ClassGroup.entryModule` in the domain. Scalar, for an INSERT.
 */
export function entryModuleIdOf(classGroupId: string): SQL<string | null> {
  return entryRun("id", classGroupId) as SQL<string | null>;
}

/** The entry run of the outer `class_groups` row. */
export function outerEntryModuleId(): SQL<string | null> {
  return entryRun("id", OUTER_CLASS_GROUP) as SQL<string | null>;
}

/** The outer class group's entry run's weekly slots — the schedule a new student buys (jsonb; null with no live run). */
export function outerEntrySlots(): SQL<unknown> {
  return entryRun("slots", OUTER_CLASS_GROUP) as SQL<unknown>;
}

/**
 * Every class group's entry run, as a subquery to join on `class_group_id`:
 * where the checkout and the manual enrollment read the schedule a new
 * student is buying.
 */
export function entryModules(db: Db) {
  return db
    .selectDistinctOn([classGroupModules.classGroupId], {
      classGroupId: classGroupModules.classGroupId,
      id: classGroupModules.id,
      module: classGroupModules.module,
      fullCourse: classGroupModules.fullCourse,
      teacherId: classGroupModules.teacherId,
      slots: classGroupModules.slots,
    })
    .from(classGroupModules)
    .where(isNull(classGroupModules.deletedAt))
    .orderBy(classGroupModules.classGroupId, ...MODULE_ORDER)
    .as("entry_module");
}
