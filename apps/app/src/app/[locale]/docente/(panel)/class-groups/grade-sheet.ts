import type { GradeStatus, StudentNote } from '@/lib/backoffice/types'
import type { TeachingStudent } from '@/lib/docente/teaching'

/**
 * The grade sheet's rules, shared by the one-grade dialog and the batch one:
 * what a typed grade is, what DA is, and what a final grade means. No UI copy
 * here (CLAUDE.md §4).
 */

/**
 * One row of the grade sheet. Grades have no API yet (OOC-38), so the sheet is
 * a working copy that lives on the screen and is drawn only behind
 * `teacher.grades`, off in production (OOC-82). Keyed by enrollment: a grade
 * belongs to the seat in this class group, not to the person.
 */
export interface GradeSheetRow {
  enrollmentId: string
  fullName: string
  /** 0–20. Null while not posted, and on a DA. */
  finalGrade: number | null
  gradeStatus: GradeStatus
  /** The teacher's observations, newest first. */
  notes: StudentNote[]
}

/** The real roster with nothing posted on it — the only honest starting point while grades are not stored anywhere. */
export function workingSheet(students: TeachingStudent[]): GradeSheetRow[] {
  return students.map((student) => ({
    enrollmentId: student.enrollmentId,
    fullName: student.studentName,
    finalGrade: null,
    gradeStatus: 'pending',
    notes: [],
  }))
}

/**
 * The institution's mark for a student who did not sit the final exam
 * (`docs/REGRAS-NEGOCIO.md` §3), written in the final-grade cell the way it
 * is on a paper sheet. Not translated: it is what the sheet says.
 */
export const DA_MARK = 'DA'

export function isDa(raw: string): boolean {
  return raw.trim().toUpperCase() === DA_MARK
}

/**
 * A grade on the 0–20 Peruvian scale, decimals allowed (`13,5` or `13.5`, up
 * to two places), or null for anything else typed. Compared to the pass mark
 * as typed — no rounding rule is applied, because none was given.
 */
export function parseGrade(raw: string): number | null {
  const value = raw.trim().replace(',', '.')
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null
  const grade = Number(value)
  return grade <= 20 ? grade : null
}

/** `passingGrade` is the backoffice's (`platform_settings`, OOC-41), never a constant. */
export function finalStatus(grade: number, passingGrade: number): GradeStatus {
  return grade >= passingGrade ? 'approved' : 'failed'
}

