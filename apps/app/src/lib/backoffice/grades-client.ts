/**
 * The supervision's grade writes (OOC-102), through the same-origin proxy.
 * The API answers `{status, reason}`; this turns the reason into a key the
 * locale can say (`class_group_grades.errors.*`) — never the API's text.
 */

export const GRADE_ERROR_KEYS = [
  'grading_closed',
  'grade_already_recorded',
  'grade_not_recorded',
  'grade_correction_unchanged',
  'grade_corrected_concurrently',
  'grade_correction_reason_required',
  'grade_out_of_range',
  'grade_unknown_enrollment',
  'generic',
] as const

export type GradeErrorKey = (typeof GRADE_ERROR_KEYS)[number]

const KNOWN: ReadonlySet<string> = new Set(GRADE_ERROR_KEYS)

/** `teaching.grade_out_of_range` → `grade_out_of_range`; anything else → `generic`. */
export function gradeErrorKey(reason: string | undefined): GradeErrorKey {
  const key = reason?.startsWith('teaching.') ? reason.slice('teaching.'.length) : undefined
  return key && KNOWN.has(key) ? (key as GradeErrorKey) : 'generic'
}

/** A grade as the dialog sends it: the 0–20 score, or DA. */
export type GradeInput = number | 'da'

export type GradeWriteResult<T> = { ok: true; data: T } | { ok: false; error: GradeErrorKey }

async function write<T>(path: string, body: unknown): Promise<GradeWriteResult<T>> {
  try {
    const response = await fetch(`/api/v1/catalog/class-groups/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return { ok: true, data: (await response.json()) as T }
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, error: gradeErrorKey(failure?.reason) }
  } catch {
    return { ok: false, error: 'generic' }
  }
}

/** Posts one missing grade. `finished` = it graded the last seat and finished the module. */
export function postGrade(classGroupId: string, enrollmentId: string, grade: GradeInput) {
  return write<{ recorded: number; alreadyRecorded: number; finished: boolean }>(
    `${encodeURIComponent(classGroupId)}/grades`,
    { entries: [{ enrollmentId, grade }] },
  )
}

/** Corrects a posted grade, with the reason that goes into its history. */
export function correctGrade(classGroupId: string, enrollmentId: string, grade: GradeInput, reason: string) {
  return write<{ correctionId: string }>(
    `${encodeURIComponent(classGroupId)}/grades/${encodeURIComponent(enrollmentId)}/correction`,
    { grade, reason },
  )
}

/**
 * Coordination's register steps (OOC-180). Answers `done`, or a key of
 * `grade_register.errors.*` the screen says — never the API's text.
 */
export type RegisterStepResult = 'done' | 'incomplete' | 'locked' | 'conflict' | 'note_required' | 'failed'

async function registerStep(path: string, body?: unknown): Promise<RegisterStepResult> {
  try {
    const response = await fetch(`/api/v1/catalog/class-groups/${path}`, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.ok) return 'done'
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    switch (failure?.reason) {
      case 'teaching.grade_register_incomplete':
      case 'teaching.grade_register_empty':
        return 'incomplete'
      case 'teaching.grade_register_wrong_status':
        return 'locked'
      case 'teaching.grade_register_note_required':
        return 'note_required'
      default:
        return response.status === 409 ? 'conflict' : 'failed'
    }
  } catch {
    return 'failed'
  }
}

/** Returns the run's register in review to its teacher, with what to correct. */
export function returnRegister(classGroupId: string, classGroupModuleId: string, note: string) {
  return registerStep(
    `${encodeURIComponent(classGroupId)}/modules/${encodeURIComponent(classGroupModuleId)}/grade-register/return`,
    { note },
  )
}

/** Confirms the run's register: its grades become official. */
export function confirmRegister(classGroupId: string, classGroupModuleId: string) {
  return registerStep(
    `${encodeURIComponent(classGroupId)}/modules/${encodeURIComponent(classGroupModuleId)}/grade-register/confirm`,
  )
}
