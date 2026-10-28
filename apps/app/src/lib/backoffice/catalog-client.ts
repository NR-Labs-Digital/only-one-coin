import type { CatalogEntryKind, CatalogErrorKey } from './types'

export type CatalogWriteResult<T> = { ok: true; data: T } | { ok: false; error: CatalogErrorKey }

const KNOWN: ReadonlySet<CatalogErrorKey> = new Set<CatalogErrorKey>([
  'course_not_found',
  'plan_not_found',
  'price_in_past',
  'period_not_found',
  'class_group_not_found',
  'invalid_date_range',
  'invalid_status_transition',
  'class_group_incomplete',
  'capacity_below_seats_taken',
  'class_group_course_locked',
  'period_already_duplicated',
  'duplicate_same_period',
  'class_group_not_full',
  'waitlist_already_joined',
  'waitlist_already_enrolled',
  'waitlist_student_not_found',
  'waitlist_entry_closed',
  'waitlist_entry_not_found',
  // Retire/restore of any catalog entry (course, plan, class group, period).
  'entry_not_found',
  'class_group_teacher_unavailable',
  'class_group_teacher_language',
  'landing_key_taken',
  'module_materials_incomplete',
  'module_material_invalid',
  'classroom_url_invalid',
  'class_group_module_out_of_range',
])

/** `catalog.price_in_past` → `price_in_past`; anything unknown → `generic`. */
export function catalogErrorKey(reason: string | undefined): CatalogErrorKey {
  const key = reason?.startsWith('catalog.') ? reason.slice('catalog.'.length) : undefined
  return key && KNOWN.has(key as CatalogErrorKey) ? (key as CatalogErrorKey) : 'generic'
}

/**
 * One catalog write through the same-origin proxy. The API answers the
 * project's error envelope `{status, reason}` (docs/ARCHITECTURE.md §5.7);
 * this turns it into a key the locale can say.
 */
export async function catalogWrite<T = { id: string }>(
  path: string,
  method: 'POST' | 'PATCH',
  body?: unknown,
): Promise<CatalogWriteResult<T>> {
  try {
    const response = await fetch(`/api/v1/catalog${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    if (response.ok) return { ok: true, data: (await response.json()) as T }
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, error: catalogErrorKey(failure?.reason) }
  } catch {
    return { ok: false, error: 'generic' }
  }
}

/** What a retire or restore answers, and what the state read answers before one. */
export interface CatalogEntryState {
  retiredAt: string | null
  liveEnrollments: number
}

/**
 * Retires or restores any catalog entry. The answer carries how many
 * enrollments were still standing on it — never a refusal (CLAUDE.md §1).
 */
export function setCatalogEntryOnOffer(
  kind: CatalogEntryKind,
  id: string,
  verb: 'retire' | 'restore',
): Promise<CatalogWriteResult<CatalogEntryState>> {
  return catalogWrite<CatalogEntryState>(`/${kind}/${encodeURIComponent(id)}/${verb}`, 'POST')
}

/**
 * How many enrollments an entry still carries, read before retiring it so the
 * confirmation can say so (OOC-70). Null when the count could not be read.
 */
export async function readCatalogEntryState(
  kind: CatalogEntryKind,
  id: string,
  signal?: AbortSignal,
): Promise<CatalogEntryState | null> {
  try {
    const response = await fetch(`/api/v1/catalog/${kind}/${encodeURIComponent(id)}/state`, { signal })
    if (!response.ok) return null
    return (await response.json()) as CatalogEntryState
  } catch {
    return null
  }
}
