import type { Role } from "../Role.js";

/**
 * Narrow read against Better Auth's own "user" table — just enough to stop an
 * invite being sent to an e-mail that already has an account, without pulling
 * in a general-purpose user repository (CLAUDE.md §8 anti-escalation section
 * keeps writes to that table behind dedicated usecases; this is read-only).
 */
export interface StaffUserDisplay {
  name: string;
  email: string;
}

/** Who a self-service password reset is addressed to. */
export interface ResettableStaffUser {
  id: string;
  name: string;
  email: string;
  /** Picks the door the reset link opens on (a teacher has their own). */
  role: Role;
}

export interface IStaffUserLookup {
  existsByEmail(email: string): Promise<boolean>;
  /** Name/e-mail for a password-reset link's completion screen. */
  findDisplayByUserId(userId: string): Promise<StaffUserDisplay | null>;
  /**
   * The panel account behind this e-mail, if one may recover its password:
   * a staff cargo (never `student`/`guardian`) whose access was not removed
   * (`banned`). Anything else answers null — the caller cannot tell "no such
   * account" from "account not allowed", and that is the point (OOC-30).
   */
  findResettableStaffByEmail(email: string): Promise<ResettableStaffUser | null>;
}
