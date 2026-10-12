import type { Role } from "@ooc/domain";

/**
 * Who opens the roster and the teacher file — mirrors `canManageTeachers` in
 * `apps/app/src/lib/backoffice/permissions.ts`. The academic supervisor exists
 * to supervise the teachers; the analyst observes every area.
 *
 * A teacher reading their own file needs the account ↔ teacher link (OOC-79)
 * and is not served here yet.
 */
export const TEACHER_READ_ROLES = [
  "master",
  "admin",
  "academic_supervisor",
  "analyst",
] as const satisfies readonly Role[];

/**
 * Who corrects a file, its week and its place on the roster. The analyst reads
 * and proposes, never edits (CLAUDE.md §8).
 */
export const TEACHER_EDIT_ROLES = ["master", "admin", "academic_supervisor"] as const satisfies readonly Role[];

/**
 * Who registers a new teacher — mirrors `canCreateTeacher`. Management only: a
 * teacher record is one invite away from an account that reads student grades.
 */
export const TEACHER_CREATE_ROLES = ["master", "admin"] as const satisfies readonly Role[];
