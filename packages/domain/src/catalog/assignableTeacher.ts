import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { ClassGroupTeacherLanguageError, ClassGroupTeacherUnavailableError } from "./errors.js";

/** Teacher languages and `courses.language` are the same free text (no languages table). */
function sameLanguage(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");
}

/**
 * The check behind allocating a teacher to a class group (OOC-80): someone on
 * the roster — active — who teaches the course's language. Runs only when the
 * allocation or the course changes: a teacher who left the roster mid-cycle
 * stays on the class group they ran, and editing its capacity is not refused
 * for it.
 */
export async function assertAssignableTeacher(
  teachers: ITeacherRepository,
  teacherId: string,
  courseLanguage: string,
): Promise<void> {
  const teacher = await teachers.findById(teacherId);
  if (!teacher || !teacher.isActive) throw new ClassGroupTeacherUnavailableError();
  if (!teacher.languages.some((language) => sameLanguage(language, courseLanguage))) {
    throw new ClassGroupTeacherLanguageError();
  }
}
