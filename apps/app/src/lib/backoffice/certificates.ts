import type {
  CertificateBlockReason,
  CertificateRule,
  ClassGroupDetail,
  ClassGroupStudent,
} from './types'

/**
 * Certificate eligibility, in one place.
 *
 * The rules come from `docs/REGRAS-NEGOCIO.md`: a minimum grade (§3), DA when
 * a final exam is missed (§3), a free certificate within a number of business
 * days of the course ending (§6), and Inglés Básico certifying only after the
 * student sits the certification exam (§6). The grade and the days are the
 * backoffice's (`platform_settings`, OOC-41) and arrive as arguments — never
 * a constant here.
 *
 * This is UI-side derivation for the mockup. The real decision belongs to a
 * usecase in `packages/domain` — the browser must never be the authority on who
 * gets a document (CLAUDE.md §8).
 */

export interface BlockedStudent {
  student: ClassGroupStudent
  reason: CertificateBlockReason
}

export interface BatchPreview {
  eligible: ClassGroupStudent[]
  blocked: BlockedStudent[]
}

/**
 * First blocking reason wins, ordered from the most actionable to the most
 * academic — the coordinator reading the list should see "cobrar el pago"
 * before "la nota no da".
 */
export function certificateBlockReason(
  student: ClassGroupStudent,
  rule: CertificateRule,
  passingGrade: number,
): CertificateBlockReason | null {
  if (student.certificateIssuedAt) return 'already_issued'
  if (student.paymentStatus !== 'approved') return 'payment_not_approved'
  if (student.enrollmentStatus !== 'completed') return 'enrollment_not_completed'
  if (student.gradeStatus === 'auto_failed') return 'auto_failed'
  if (student.gradeStatus === 'pending') return 'grade_pending'
  if (student.finalGrade === null || student.finalGrade < passingGrade) {
    return 'grade_below_minimum'
  }
  if (rule === 'exam_required' && student.certificationExam !== 'approved') {
    return 'exam_not_approved'
  }
  return null
}

/** Splits the roster into who the batch would issue for and who it would skip. */
export function batchPreview(group: ClassGroupDetail, passingGrade: number): BatchPreview {
  const eligible: ClassGroupStudent[] = []
  const blocked: BlockedStudent[] = []

  for (const student of group.students) {
    const reason = certificateBlockReason(student, group.certificateRule, passingGrade)
    if (reason === null) eligible.push(student)
    else blocked.push({ student, reason })
  }

  return { eligible, blocked }
}

/**
 * Adds business days to a date, weekends only. Peruvian public holidays are NOT
 * subtracted yet — that needs a holiday calendar, and guessing one would make
 * the deadline lie.
 */
export function addBusinessDays(isoDate: string, days: number): Date {
  const date = new Date(`${isoDate}T00:00:00Z`)
  let left = days
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6) left -= 1
  }
  return date
}

/** Business days the institution has left to issue — negative once overdue. */
export function businessDaysUntil(target: Date, from: Date): number {
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  )
  const end = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()),
  )
  const overdue = end < start
  const [a, b] = overdue ? [end, start] : [start, end]
  const cursor = new Date(a)
  let count = 0
  while (cursor < b) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return overdue ? -count : count
}
