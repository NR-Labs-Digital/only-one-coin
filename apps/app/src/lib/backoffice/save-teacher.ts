// Client-safe: the teacher forms call the same-origin `/api/v1` proxy with
// these, never the database (CLAUDE.md §8).

import type { FieldErrorCode } from '@ooc/domain/fields'
import { parseFieldErrors } from '@/lib/field-errors'

/**
 * Why a write failed, as something the form can say — never the API's
 * `reason` string carried into the markup (CLAUDE.md §4). `fields` is keyed by
 * the bare field name, or `availability` for anything about the week.
 */
export type TeacherSaveFailure =
  | { kind: 'invalid'; fields: Partial<Record<string, FieldErrorCode>> }
  | { kind: 'duplicate' }
  | { kind: 'generic' }

export type TeacherSaveResult<T> = { ok: true; value: T } | { ok: false; failure: TeacherSaveFailure }

/**
 * Sends one write and reads the answer. A body the route refused names
 * `email`; a rule the domain refused names `teacher.email`; a window of the
 * week names `availability.2` — the form only knows `email` and `availability`.
 */
export async function saveTeacher<T>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
): Promise<TeacherSaveResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (response.ok) return { ok: true, value: (await response.json()) as T }

    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    const fields = parseFieldErrors(failure)
    if (fields.length > 0) {
      return {
        ok: false,
        failure: {
          kind: 'invalid',
          fields: Object.fromEntries(
            fields.map((field) => [field.path.replace(/^teacher\./, '').split('.')[0], field.code]),
          ),
        },
      }
    }
    if (failure?.reason === 'teacher.already_registered') return { ok: false, failure: { kind: 'duplicate' } }
    return { ok: false, failure: { kind: 'generic' } }
  } catch {
    return { ok: false, failure: { kind: 'generic' } }
  }
}
