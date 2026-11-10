import type { Role } from "@ooc/domain";

/**
 * Who reads the automatic e-mails' screens (OOC-88): management, the
 * enrollment supervisor — whose students are the ones receiving them — and
 * the analyst, who observes every area. The same cargos `canManageEmail`
 * opens the section to in `apps/app`; the figures are counts and the preview
 * renders invented data, so nobody here reads a real student's message.
 */
export const EMAIL_FLOW_ROLES = ["master", "admin", "enrollment_supervisor", "analyst"] as const satisfies readonly Role[];

/**
 * Who sends a proof (OOC-89): the readers minus the analyst, who observes and
 * never acts (CLAUDE.md §8). A proof is a real e-mail leaving the platform,
 * even with invented data in it.
 */
export const EMAIL_PROOF_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];
