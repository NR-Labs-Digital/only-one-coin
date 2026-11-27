// Client-safe: the screens call the same-origin `/api/v1` proxy (CLAUDE.md §8).

import type { FieldErrorCode } from '@ooc/domain/fields'
import { parseFieldErrors } from '@/lib/field-errors'

/** Why a write failed, as something the screen can say (CLAUDE.md §4). */
export type ClassroomAccountFailure =
  | { kind: 'invalid'; fields: Partial<Record<'email' | 'password', FieldErrorCode>> }
  | { kind: 'exists' }
  | { kind: 'in_use' }
  /** The sealed password could not be opened (503): type it again. */
  | { kind: 'unavailable' }
  | { kind: 'generic' }

export type ClassroomResult<T> = { ok: true; value: T } | { ok: false; failure: ClassroomAccountFailure }

/** What a password reveal answers — the staff screen's and the teacher portal's. */
export interface ClassroomCredentials {
  email: string
  password: string
  passwordChangedAt: string
}

async function send<T>(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<ClassroomResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    if (response.ok) {
      return { ok: true, value: (response.status === 204 ? null : await response.json()) as T }
    }
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    const fields = parseFieldErrors(failure)
    if (fields.length > 0) {
      return {
        ok: false,
        failure: {
          kind: 'invalid',
          fields: Object.fromEntries(
            fields.map((field) => [field.path.replace(/^classroomAccount\./, '').split('.')[0], field.code]),
          ),
        },
      }
    }
    if (failure?.reason === 'classroom_account.exists') return { ok: false, failure: { kind: 'exists' } }
    if (failure?.reason === 'classroom_account.in_use') return { ok: false, failure: { kind: 'in_use' } }
    if (failure?.reason === 'classroom_account.credentials_unavailable') {
      return { ok: false, failure: { kind: 'unavailable' } }
    }
    return { ok: false, failure: { kind: 'generic' } }
  } catch {
    return { ok: false, failure: { kind: 'generic' } }
  }
}

export function createClassroomAccount(body: { email: string; password: string }) {
  return send<{ id: string }>('/api/v1/classroom-accounts', 'POST', body)
}

export function updateClassroomAccount(id: string, body: { email?: string; password?: string }) {
  return send<{ id: string }>(`/api/v1/classroom-accounts/${encodeURIComponent(id)}`, 'PATCH', body)
}

export function retireClassroomAccount(id: string) {
  return send<null>(`/api/v1/classroom-accounts/${encodeURIComponent(id)}/retire`, 'POST')
}

/** Every call is an audit line on the API — call it on a click, never on render. */
export function revealClassroomPassword(id: string) {
  return send<ClassroomCredentials>(`/api/v1/classroom-accounts/${encodeURIComponent(id)}/password`, 'POST')
}

/** The signed-in teacher's own login (`access: null` = none assigned). Audited, like the staff reveal. */
export function revealOwnClassroomAccess() {
  return send<{ access: ClassroomCredentials | null }>('/api/v1/teaching/classroom-access', 'POST')
}
