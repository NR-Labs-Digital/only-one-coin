import type { GradeStatus } from '@/lib/backoffice/types'
import type { PendingGrade } from '@/lib/docente/grade-outbox'
import type { TeachingGrade, TeachingStudent } from '@/lib/docente/teaching'

/**
 * The grade sheet's rules, shared by the teacher's one-grade dialog, the batch
 * one and the supervision's grade card in the backoffice (OOC-102):
 * what a typed grade is, what DA is, and what a final grade means. No UI copy
 * here (CLAUDE.md §4).
 */

/**
 * One row of the grade sheet (OOC-38). Keyed by enrollment: a grade belongs
 * to the seat in this class group, not to the person.
 */
export interface GradeSheetRow {
  enrollmentId: string
  fullName: string
  /** 0–20. Null while not posted, and on a DA. */
  finalGrade: number | null
  gradeStatus: GradeStatus
  /**
   * `posted` — the API holds it, final. `pending` — confirmed on this device
   * and not acknowledged yet (no connection); it is sent again. `null` —
   * nothing yet.
   */
  sync: 'posted' | 'pending' | null
  /** The academic supervision corrected the posted grade (OOC-102). */
  corrected: boolean
}

/**
 * The roster with what is posted on it, and on top what this device still
 * has to send. A posted grade wins over a pending one for the same seat: the
 * API is the record, and a pending copy of it is a resend about to be a no-op.
 */
export function gradeSheet(
  students: TeachingStudent[],
  posted: TeachingGrade[],
  pending: PendingGrade[],
  passingGrade: number,
): GradeSheetRow[] {
  const postedBy = new Map(posted.map((grade) => [grade.enrollmentId, grade]))
  const pendingBy = new Map(pending.map((entry) => [entry.enrollmentId, entry]))
  return students.map((student) => {
    const grade = postedBy.get(student.enrollmentId)
    const base = {
      enrollmentId: student.enrollmentId,
      fullName: student.studentName,
      corrected: Boolean(grade?.correctedAt),
    }
    if (grade) {
      if (grade.didNotSit || grade.grade === null) {
        return { ...base, finalGrade: null, gradeStatus: 'auto_failed', sync: 'posted' }
      }
      return { ...base, finalGrade: grade.grade, gradeStatus: finalStatus(grade.grade, passingGrade), sync: 'posted' }
    }
    const waiting = pendingBy.get(student.enrollmentId)
    if (waiting) {
      if (waiting.grade === 'da') return { ...base, finalGrade: null, gradeStatus: 'auto_failed', sync: 'pending' }
      return { ...base, finalGrade: waiting.grade, gradeStatus: finalStatus(waiting.grade, passingGrade), sync: 'pending' }
    }
    return { ...base, finalGrade: null, gradeStatus: 'pending', sync: null }
  })
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

