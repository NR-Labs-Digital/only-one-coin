/**
 * The grade sheet's own outbox (OOC-38): grades the teacher confirmed that
 * the API has not acknowledged yet. They are kept on the device, so a phone
 * that loses its connection in the middle of posting — or is closed — loses
 * nothing: the sheet shows them as "not sent yet" and sends them again when
 * the connection comes back.
 *
 * Resending is safe by construction: the API takes the same grade on the same
 * seat as already done (`RecordOwnClassGroupGradesUseCase`), and refuses a
 * different one.
 *
 * Storage can be missing or throw (private window, blocked site data), so
 * every access is guarded; without it the sheet still posts, it just cannot
 * survive a reload.
 */

/** What one confirmed cell posts: the final exam's grade, or `'da'`. */
export interface PendingGrade {
  enrollmentId: string
  grade: number | 'da'
}

const pendingKey = (classGroupId: string) => `ooc:grades:pending:${classGroupId}`
const draftKey = (classGroupId: string) => `ooc:grades:draft:${classGroupId}`

function isPendingGrade(value: unknown): value is PendingGrade {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.enrollmentId === 'string' &&
    (entry.grade === 'da' || (typeof entry.grade === 'number' && Number.isFinite(entry.grade)))
  )
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* No storage: the sheet keeps working, without surviving a reload. */
  }
}

export function readPendingGrades(classGroupId: string): PendingGrade[] {
  const value = read(pendingKey(classGroupId))
  return Array.isArray(value) ? value.filter(isPendingGrade) : []
}

export function writePendingGrades(classGroupId: string, pending: PendingGrade[]): void {
  write(pendingKey(classGroupId), pending.length === 0 ? null : pending)
}

/**
 * Adds what was just confirmed to what is still waiting. A seat already
 * waiting keeps its first value: a cell is offered only while empty, so a
 * second value for the same seat can only be a stale screen.
 */
export function mergePendingGrades(current: PendingGrade[], added: PendingGrade[]): PendingGrade[] {
  const seats = new Set(current.map((entry) => entry.enrollmentId))
  return [...current, ...added.filter((entry) => !seats.has(entry.enrollmentId))]
}

/** What the batch dialog had typed, per seat — so a reload mid-typing loses nothing. */
export interface GradeDraftRow {
  grade: string
  da: boolean
}

export function readGradeDraft(classGroupId: string): Record<string, GradeDraftRow> {
  const value = read(draftKey(classGroupId))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const rows: Record<string, GradeDraftRow> = {}
  for (const [id, row] of Object.entries(value as Record<string, unknown>)) {
    if (typeof row !== 'object' || row === null) continue
    const { grade, da } = row as Record<string, unknown>
    if (typeof grade === 'string' && typeof da === 'boolean') rows[id] = { grade, da }
  }
  return rows
}

export function writeGradeDraft(classGroupId: string, rows: Record<string, GradeDraftRow>): void {
  const filled = Object.entries(rows).filter(([, row]) => row.da || row.grade.trim() !== '')
  write(draftKey(classGroupId), filled.length === 0 ? null : Object.fromEntries(filled))
}

/**
 * - `posted` — the API holds them (written now or already there).
 * - `offline` — the request did not get an answer worth trusting (no network,
 *   5xx, 429): keep them and try again.
 * - `conflict` — a seat already has a different grade (the screen was stale).
 * - `refused` — the API said no for good (closed class group, unknown seat).
 */
export type PostGradesResult = 'posted' | 'offline' | 'conflict' | 'refused'

export async function postGrades(
  classGroupId: string,
  entries: PendingGrade[],
): Promise<PostGradesResult> {
  try {
    const response = await fetch(
      `/api/v1/teaching/class-groups/${encodeURIComponent(classGroupId)}/grades`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries }),
      },
    )
    if (response.ok) return 'posted'
    if (response.status === 409) return 'conflict'
    if (response.status === 429 || response.status >= 500) return 'offline'
    return 'refused'
  } catch {
    return 'offline'
  }
}
