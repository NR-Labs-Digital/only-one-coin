import type { Role } from "@ooc/domain";

/**
 * Who reads the undelivered e-mails screen (OOC-90) — the same cargos that
 * open the e-mail section in the panel (`canManageEmail`): management, the
 * enrollment side, and the analyst, who observes every area.
 */
export const EMAIL_DELIVERY_READ_ROLES = ["master", "admin", "enrollment_supervisor", "analyst"] as const satisfies readonly Role[];

/** Who resends: the readers minus the analyst, who never edits (CLAUDE.md §8). */
export const EMAIL_DELIVERY_RESEND_ROLES = ["master", "admin", "enrollment_supervisor"] as const satisfies readonly Role[];
