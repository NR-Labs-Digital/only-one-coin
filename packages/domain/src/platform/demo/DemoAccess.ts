/*
 * Demo accesses (28/11/2026): an account the platform owners open so a
 * client can see the student or the teacher portal from the inside and give
 * feedback, without a real enrollment or a real teacher file behind it.
 *
 * Each access writes, in one transaction, a demo class group (in progress, in
 * a live course the owner picks, never on sale) with its first module run,
 * and inside it either a demo student with a confirmed seat or a demo teacher
 * running the module with a few fictitious demo students to grade. Every row
 * carries `is_demo`, and every list the team works from leaves them out — the
 * operation never sees them (apps/api CLAUDE.md, "Contas demo").
 *
 * The account itself goes through the doors that already exist: the portal
 * access a payment approval opens (set-password link, never a password), and
 * the teacher invite tied to the file (OOC-79).
 */

export const DEMO_ACCESS_KINDS = ["student", "teacher"] as const;
export type DemoAccessKind = (typeof DEMO_ACCESS_KINDS)[number];

/** How many fictitious students a teacher's demo class group carries, to grade. */
export const DEMO_TEACHER_ROSTER_SIZE = 3;

/**
 * Where e-mails to the fictitious students would go. `.invalid` is reserved
 * (RFC 2606) and never resolves; the outbox relay also refuses it outright, so
 * a grade a demo teacher posts never reaches anybody.
 */
export const DEMO_UNDELIVERABLE_DOMAIN = "demo.invalid";

export function isUndeliverableDemoAddress(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${DEMO_UNDELIVERABLE_DOMAIN}`);
}

export interface DemoAccessView {
  id: string;
  kind: DemoAccessKind;
  email: string;
  name: string;
  courseName: string;
  classGroupCode: string;
  /** Whether the person already set a password (student) or accepted the invite (teacher). */
  activated: boolean;
  createdAt: Date;
  createdByName: string | null;
  revokedAt: Date | null;
}

export interface DemoCourseOption {
  id: string;
  name: string;
  language: string;
}
