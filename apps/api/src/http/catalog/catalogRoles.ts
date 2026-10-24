import type { Role } from "@ooc/domain";

/**
 * Who reads the catalog in the backoffice — the same people who read the
 * enrollment ledger (apps/app permissions.ts canBrowseEnrollments). Billing
 * settles money and sees no academic data; a teacher sees their own class
 * groups through `/teaching` (OOC-82), scoped by the session in the usecase.
 */
export const CATALOG_READ_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "sales",
  "support",
] as const satisfies readonly Role[];

/** Who opens and runs class groups and periods (CLAUDE.md §1, §8). */
export const CATALOG_WRITE_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];

/** Who opens a course, renames it, and sets money (CLAUDE.md §1 "sem descontos"). */
export const CATALOG_OWNER_ROLES = ["master", "admin"] as const satisfies readonly Role[];
