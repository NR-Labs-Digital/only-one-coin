import { apiFetch } from './api-client'
import type { EnrollmentMetrics, EnrollmentRow } from './types'

export interface EnrollmentLedger {
  items: EnrollmentRow[]
  metrics: EnrollmentMetrics
  /** The ledger holds more than `items` carries — the API caps the read
   * until this screen pages server-side the way the directory does. */
  truncated: boolean
}

/**
 * The enrollment ledger, read from `apps/api` (`GET /api/v1/enrollments`).
 *
 * Until this existed the screen read `mock-data.ts`, whose fixtures were
 * emptied — so a real enrollment written by the public checkout minutes
 * earlier showed up nowhere, and a manually opened one vanished on reload.
 *
 * `null` means the API failed (error response or unreachable), never "no
 * enrollments": the page shows a visible error for it, because a silent empty
 * table is indistinguishable from an institution that sold nothing.
 */
export async function listEnrollments(): Promise<EnrollmentLedger | null> {
  try {
    const response = await apiFetch('/api/v1/enrollments')
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}
