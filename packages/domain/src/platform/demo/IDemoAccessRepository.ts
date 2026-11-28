import type { DemoAccessKind, DemoAccessView, DemoCourseOption } from "./DemoAccess.js";

export interface DemoKitInput {
  courseId: string;
  firstName: string;
  lastName: string;
  email: string;
  actorId: string;
  at: Date;
}

export interface DemoKit {
  accessId: string;
  classGroupId: string;
  /** The demo student (student access) or the demo teacher (teacher access). */
  ownerId: string;
}

export interface RevokedDemoAccess {
  kind: DemoAccessKind;
  classGroupId: string;
}

/**
 * The demo rows (28/11/2026). Each kit is written in one transaction — the
 * demo class group, its first module run, and the demo student with a
 * confirmed seat, or the demo teacher running it with its fictitious roster.
 * Throws `DemoCourseUnavailableError` when the course is not live, has no
 * one-off (package) plan with a price, or no period has started yet.
 */
export interface IDemoAccessRepository {
  /** Whether any account, open invite or live file already uses this address. */
  emailInUse(email: string): Promise<boolean>;
  createStudentKit(input: DemoKitInput): Promise<DemoKit>;
  createTeacherKit(input: DemoKitInput): Promise<DemoKit>;
  /**
   * Closes the account (retired like a deleted staff profile: blocked, sessions
   * dropped, e-mail swapped for a marker so the address can be used again),
   * cancels an invite still open, takes the teacher off the roster and retires
   * the class group. Null when there is no such access or it was revoked.
   */
  revoke(id: string, actorId: string, at: Date): Promise<RevokedDemoAccess | null>;
  list(): Promise<DemoAccessView[]>;
  courseOptions(): Promise<DemoCourseOption[]>;
}
