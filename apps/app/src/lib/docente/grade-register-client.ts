/**
 * The teacher's writes on the grade register (OOC-180), from the browser,
 * through the app's `/api/v1` proxy — the same door as posting grades. Online
 * only: unlike posting, an edit and a send are answered before the screen
 * moves on, so a lost one is never mistaken for a done one.
 *
 * The result is a reason the screen turns into text (CLAUDE.md §4) — never
 * the API's message.
 */
export type RegisterWriteResult =
  | 'done'
  /** Some student of the round still has no grade. */
  | 'incomplete'
  /** The register is in review or official — not the teacher's any more. */
  | 'locked'
  /** Somebody moved it at the same moment. */
  | 'conflict'
  | 'unchanged'
  | 'failed'

async function resultOf(response: Response): Promise<RegisterWriteResult> {
  if (response.ok) return 'done'
  const body = (await response.json().catch(() => null)) as {
    reason?: unknown
  } | null
  switch (body?.reason) {
    case 'teaching.grade_register_incomplete':
    case 'teaching.grade_register_empty':
      return 'incomplete'
    case 'teaching.grade_register_locked':
    case 'teaching.grade_register_wrong_status':
      return 'locked'
    case 'teaching.grade_correction_unchanged':
      return 'unchanged'
    default:
      return response.status === 409 ? 'conflict' : 'failed'
  }
}

export async function submitGradeRegister(classGroupId: string): Promise<RegisterWriteResult> {
  try {
    const response = await fetch(
      `/api/v1/teaching/class-groups/${encodeURIComponent(classGroupId)}/grade-register/submit`,
      { method: 'POST' },
    )
    return await resultOf(response)
  } catch {
    return 'failed'
  }
}

export async function editGrade(
  classGroupId: string,
  enrollmentId: string,
  grade: number | 'da',
): Promise<RegisterWriteResult> {
  try {
    const response = await fetch(
      `/api/v1/teaching/class-groups/${encodeURIComponent(classGroupId)}/grades/${encodeURIComponent(enrollmentId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grade }),
      },
    )
    return await resultOf(response)
  } catch {
    return 'failed'
  }
}
