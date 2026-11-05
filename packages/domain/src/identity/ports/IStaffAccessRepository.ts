import type { Role } from "../Role.js";

/**
 * Opens/closes the door without touching the account itself (CLAUDE.md §8 —
 * removing access is not a delete, whoever approved a payment or signed a
 * grade stays pointed at by those rows). Backed by Better Auth's `admin`
 * plugin (`banned`/`banReason`), which is also what makes a removed account
 * actually fail sign-in, not just read as inactive in the panel.
 */
export interface RetirableStaffAccount {
  email: string;
  role: Role;
  /** A live teacher file points at this account (`teachers.user_id`). */
  hasTeacherFile: boolean;
}

export interface IStaffAccessRepository {
  /** False when no live account has this id: a retired one stays closed. */
  ban(userId: string, reason: string): Promise<boolean>;
  /** False when no live account has this id: a retired one never reopens. */
  unban(userId: string): Promise<boolean>;
  /** A live panel account (never `student`/`guardian`), or null. */
  findRetirable(userId: string): Promise<RetirableStaffAccount | null>;
  /**
   * Marks the account retired, closes it, swaps its e-mail for `retiredEmail`
   * and ends its sessions, all in one transaction. False when no live panel
   * account has this id.
   */
  retire(userId: string, retiredEmail: string): Promise<boolean>;
}
