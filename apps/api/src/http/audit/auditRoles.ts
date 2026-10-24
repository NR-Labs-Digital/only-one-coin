import type { Role } from "@ooc/domain";

/**
 * Who reads the general audit log (OOC-122): management, and the analyst,
 * who observes every area without editing any (CLAUDE.md §8). The log names
 * students, payments and staff across the whole platform, so no cargo that
 * only works one area reads it. Proposed in the ticket and still to be
 * confirmed by the owner — one constant, so a different answer is one line.
 */
export const AUDIT_LOG_ROLES = ["master", "admin", "analyst"] as const satisfies readonly Role[];
