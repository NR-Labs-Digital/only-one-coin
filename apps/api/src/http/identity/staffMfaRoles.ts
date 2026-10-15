import type { Role } from "@ooc/domain";

/**
 * Every staff cargo: everyone with a panel account owns their own second
 * factor — mandatory for some (`MFA_REQUIRED_ROLES`), optional for the rest
 * (CLAUDE.md §8). The routes act on the session's own user, never an id from
 * the client.
 */
export const STAFF_MFA_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
] as const satisfies readonly Role[];
