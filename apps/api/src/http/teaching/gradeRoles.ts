import type { Role } from "@ooc/domain";

/**
 * Who reads a class group's grades from the backoffice (OOC-102): the
 * academic supervision and management, the analyst, who observes every area
 * and changes nothing, and the academic assistant (OOC-96), who reads grades
 * by teacher and never posts or corrects one. The teacher reads their own
 * through `/teaching/*`.
 */
export const GRADE_READ_ROLES = [
  "master",
  "admin",
  "academic_supervisor",
  "academic_assistant",
  "analyst",
] as const satisfies readonly Role[];

/** Who posts the missing grades and corrects a posted one (OOC-102, decision of 10/11/2026). */
export const GRADE_WRITE_ROLES = ["master", "admin", "academic_supervisor"] as const satisfies readonly Role[];
