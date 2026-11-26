/**
 * The teacher's acta de notas (OOC-176): one row per official grade register,
 * as `GET /grade-register-records` and `GET /teaching/grade-register-records`
 * return it. Counts only — never a grade.
 */
export interface GradeRecordRow {
  registerId: string
  classGroupId: string
  classGroupModuleId: string
  round: number
  classGroupCode: string
  classGroupStatus: string
  courseName: string
  academicPeriodId: string
  academicPeriodName: string
  module: number | null
  teacherId: string | null
  teacherName: string | null
  /** ISO 8601, UTC. */
  confirmedAt: string
  confirmedByName: string | null
  students: number
  passed: number
  failed: number
  didNotSit: number
  /** ISO 8601, UTC — the last correction after official; null when none. */
  correctedAt: string | null
  /** ISO 8601, UTC — the first download; null while nobody downloaded it. */
  recordedAt: string | null
}

/** Who downloads: the panel reaches every acta, the teacher portal only the teacher's own. */
export type GradeRecordScope = 'staff' | 'teacher'

/** Why a download did not come out, as the screen says it. */
export type GradeRecordFailure = 'not_published' | 'no_teacher' | 'unavailable' | 'generic'
