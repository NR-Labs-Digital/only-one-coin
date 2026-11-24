import type { Role } from "@ooc/domain";

/**
 * Who reads the catalog in the backoffice — the same people who read the
 * enrollment ledger (apps/app permissions.ts canBrowseEnrollments), plus the
 * academic assistant (OOC-96), who reads the class groups and the teachers'
 * week to run the roster but not the ledger. Billing settles money and sees no
 * academic data; a teacher sees their own class groups through `/teaching`
 * (OOC-82), scoped by the session in the usecase.
 */
export const CATALOG_READ_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "academic_assistant",
  "sales",
  "support",
] as const satisfies readonly Role[];

/** Who opens and runs class groups and periods (CLAUDE.md §1, §8). */
export const CATALOG_WRITE_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];

/**
 * Who opens and runs class groups and their module runs (OOC-95, decision of
 * 20/11/2026): the catalog writers plus the academic supervisor, who assigns
 * the teacher, Classroom and Meet of each run and moves a class group along.
 * Periods, course options, retiring and the waitlist stay with
 * CATALOG_WRITE_ROLES.
 */
export const CLASS_GROUP_WRITE_ROLES = [...CATALOG_WRITE_ROLES, "academic_supervisor"] as const satisfies readonly Role[];

/** Who opens a course, renames it, and sets money (CLAUDE.md §1 "sem descontos"). */
export const CATALOG_OWNER_ROLES = ["master", "admin"] as const satisfies readonly Role[];
