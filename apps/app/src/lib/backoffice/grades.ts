import { apiFetch } from './api-client'

/**
 * A class group's grade sheet as the academic supervision reads it (OOC-102),
 * from `GET /catalog/class-groups/:id/grades`. Who may read it is the API's
 * call (GRADE_READ_ROLES); the screen only draws what came.
 */

/** One step of a grade's history, oldest first: the posting, then each change. */
export interface GradeHistoryStep {
  /** The posting, the teacher's own edit (OOC-180), or the supervision's correction. */
  kind: 'posted' | 'teacher_edit' | 'correction'

  /** 0–20; null on a DA. */
  grade: number | null
  didNotSit: boolean
  /** ISO 8601 UTC. */
  at: string
  byName: string | null
  /** Null on the posting itself. */
  reason: string | null
}

export interface SheetGrade {
  /** The grade that counts — the last correction, or the posted one. Null on a DA. */
  grade: number | null
  didNotSit: boolean
  recordedAt: string
  /** Null while never changed. */
  correctedAt: string | null
  /** Coordination confirmed its register (OOC-180), or it predates registers. */
  official: boolean
  history: GradeHistoryStep[]
}

export interface GradeSheetSeat {
  enrollmentId: string
  firstName: string
  lastName: string
  /** Null while no grade was posted for the seat. */
  grade: SheetGrade | null
}

/** Null when the read failed — never an empty sheet that would read as "nobody". */
export async function getClassGroupGradeSheet(classGroupId: string): Promise<GradeSheetSeat[] | null> {
  try {
    const response = await apiFetch(`/api/v1/catalog/class-groups/${encodeURIComponent(classGroupId)}/grades`)
    if (!response.ok) return null
    const body = (await response.json()) as { seats: GradeSheetSeat[] }
    return body.seats
  } catch {
    return null
  }
}
