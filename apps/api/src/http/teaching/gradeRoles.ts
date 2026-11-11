import type { Role } from "@ooc/domain";

/**
 * Who reads a class group's grades from the backoffice (OOC-102): the
 * academic supervision and management, and the analyst, who observes every
 * area and changes nothing. "Assistente Acadêmico só visualiza" in the ticket
 * is read as the analyst — there is no role by that name (to confirm with the
 * owner). The teacher reads their own through `/teaching/*`.
 */
export const GRADE_READ_ROLES = ["master", "admin", "academic_supervisor", "analyst"] as const satisfies readonly Role[];

/** Who posts the missing grades and corrects a posted one (OOC-102, decision of 10/11/2026). */
export const GRADE_WRITE_ROLES = ["master", "admin", "academic_supervisor"] as const satisfies readonly Role[];
