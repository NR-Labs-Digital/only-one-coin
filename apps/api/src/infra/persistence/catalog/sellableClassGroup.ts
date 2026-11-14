import { academicPeriods, classGroups, courses } from "@ooc/db";
import { and, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

/**
 * What "this class group is on sale right now" means, written once (OOC-35):
 * enrolling, not retired, inside its enrollment window when it has one, and
 * neither its period nor its course retired (CLAUDE.md §1, "Catálogo sai do
 * ar, não some"). The public checkout, the manual-enrollment picker and the
 * checkout claim all read through this — a draft, a window that closed or a
 * retired period/course must disappear from all three at once.
 *
 * The period and course checks are correlated `exists`, not joins, so the
 * predicate also works inside an UPDATE on class_groups (the claim) and
 * needs nothing from the caller's FROM clause.
 */
export function sellableClassGroup(now: SQL = sql`now()`): SQL {
  return and(
    eq(classGroups.status, "enrolling"),
    isNull(classGroups.deletedAt),
    or(isNull(classGroups.enrollmentOpensAt), lte(classGroups.enrollmentOpensAt, now)),
    or(isNull(classGroups.enrollmentClosesAt), gt(classGroups.enrollmentClosesAt, now)),
    sql`exists (select 1 from ${academicPeriods} p where p.id = ${classGroups.academicPeriodId} and p.deleted_at is null)`,
    sql`exists (select 1 from ${courses} c where c.id = ${classGroups.courseId} and c.deleted_at is null)`,
  )!;
}

/**
 * Where staff can move an enrollment to (OOC-84): a class group still running
 * — enrolling or in progress — not retired, with its period and course not
 * retired. Wider than `sellableClassGroup` on purpose: a move is the staff
 * acting outside the checkout's window, and a student changing schedule after
 * the module started is the usual case. Read by the move's target check, its
 * seat UPDATE and the screen's picker, so the three never disagree.
 */
export function movableClassGroup(): SQL {
  return and(
    inArray(classGroups.status, ["enrolling", "in_progress"]),
    isNull(classGroups.deletedAt),
    sql`exists (select 1 from ${academicPeriods} p where p.id = ${classGroups.academicPeriodId} and p.deleted_at is null)`,
    sql`exists (select 1 from ${courses} c where c.id = ${classGroups.courseId} and c.deleted_at is null)`,
  )!;
}
