/**
 * The grade register as the screens read it (OOC-180) — types and the one
 * rule the teacher's screen applies. No server import here: the teacher's
 * workspace is a client component.
 */

/** The grade register's states (OOC-180): Sin enviar · En revisión · Devuelto · Oficial. */
export type GradeRegisterStatus = 'draft' | 'in_review' | 'returned' | 'official'

export interface GradeRegisterStep {
  kind: 'submitted' | 'returned' | 'confirmed'
  /** ISO 8601 UTC. */
  at: string
  byName: string | null
  /** What coordination asked to correct — only on a return. */
  note: string | null
}

/** One module run's grades for one round of the module (OOC-180). */
export interface GradeRegister {
  /** Null while nothing of this round was posted yet. */
  registerId: string | null
  classGroupId: string
  classGroupModuleId: string
  round: number
  status: GradeRegisterStatus
  /** `YYYY-MM-DD`, a calendar day in Lima; null = coordination has not set it. */
  moduleEndsOn: string | null
  /** ISO 8601 UTC; null without an end date. */
  deadlineAt: string | null
  /** Not sent and past the deadline ("Fuera de plazo"). */
  overdue: boolean
  submittedLate: boolean
  graded: number
  total: number
  returnNote: string | null
  steps: GradeRegisterStep[]
}

/** The teacher changes grades while the register is theirs: not sent, or returned. */
export function registerIsTeachers(status: GradeRegisterStatus): boolean {
  return status === 'draft' || status === 'returned'
}
