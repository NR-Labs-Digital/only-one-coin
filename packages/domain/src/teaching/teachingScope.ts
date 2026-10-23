import type { ClassGroupStatus } from "../catalog/ClassGroup.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import type { TeachingClassGroup } from "./TeachingReader.js";

/**
 * What a teacher's portal holds. A class group leaves it when coordination
 * closes it — not when it finishes, because the final exam's grade and the
 * report come after the last class (decision 08/10/2026). A draft is not in it
 * yet: it is coordination's work in progress, off sale, and its teacher may
 * still change. A retired one is off the catalog.
 */
const IN_PORTAL: ReadonlySet<ClassGroupStatus> = new Set(["enrolling", "in_progress", "finished"]);

/** Still enrolling or running — what counts as the teacher's load right now. */
const TEACHING: ReadonlySet<ClassGroupStatus> = new Set(["enrolling", "in_progress"]);

/**
 * The check every read of the portal goes through: allocated to this teacher,
 * and still in the portal. A teacher with no file has no id to compare, and a
 * class group with nobody allocated matches nobody — `null` is never an id
 * (CLAUDE.md §8).
 */
export function isOwnClassGroup(teacherId: string | null, group: TeachingClassGroup): boolean {
  if (teacherId === null || group.teacherId === null) return false;
  return group.teacherId === teacherId && !group.retired && IN_PORTAL.has(group.status);
}

export function isTeaching(group: Pick<TeachingClassGroup, "status">): boolean {
  return TEACHING.has(group.status);
}

/**
 * The teacher behind a panel account — the file `teachers.user_id` links to it
 * (OOC-79). The id comes from the session, never from the client; an account
 * linked to no file has none, and owns nothing.
 */
export async function ownTeacherId(teachers: ITeacherRepository, userId: string): Promise<string | null> {
  const teacher = await teachers.findByUserId(userId);
  return teacher?.id ?? null;
}
