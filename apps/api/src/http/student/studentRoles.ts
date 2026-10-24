import type { Role } from "@ooc/domain";

/**
 * Who registers, reads and corrects a student file: management and enrollment
 * supervision (CLAUDE.md §1, "/backoffice/students"). Editing went to the same
 * three as registration — `support` does not correct contact either (decision
 * of 07/10/2026, OOC-74).
 */
export const STUDENT_FILE_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];

/**
 * Who takes the directory away as a file (OOC-121): the same three who keep
 * the file, so nobody exports a contact or document they would not already
 * see in the ficha. `sales` and `support` answer for students one at a time;
 * the whole base does not leave with them. Proposed in the ticket, kept
 * apart from `STUDENT_FILE_ROLES` so a different answer is one line.
 */
export const STUDENT_EXPORT_ROLES = STUDENT_FILE_ROLES;
