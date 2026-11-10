import type { Role } from "@ooc/domain";

/**
 * Who opens a manual enrollment and uploads its receipt (CLAUDE.md §1,
 * "/backoffice/enrollments"): never billing, who settles the money it brings.
 * The receipt routes declare the same three as POST /enrollments.
 */
export const MANUAL_ENROLLMENT_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];
