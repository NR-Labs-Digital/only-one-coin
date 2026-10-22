import type { Role } from "@ooc/domain";

/**
 * Who opens the roster and the teacher file — mirrors `canManageTeachers` in
 * `apps/app/src/lib/backoffice/permissions.ts`. The academic supervisor exists
 * to supervise the teachers; the analyst observes every area.
 *
 * A teacher reads their own file only, through `GET /teachers/:teacherId`
 * (TEACHER_OWN_FILE_ROLES): the file is the one `teachers.user_id` links to
 * the session's account (OOC-79), never an id the client sends.
 */
export const TEACHER_READ_ROLES = [
  "master",
  "admin",
  "academic_supervisor",
  "analyst",
] as const satisfies readonly Role[];

/** Who opens a single teacher file: the readers above, plus the teacher themself. */
export const TEACHER_OWN_FILE_ROLES = [...TEACHER_READ_ROLES, "teacher"] as const satisfies readonly Role[];

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
