import { apiFetch } from './api-client'
import type { EnrollmentMetrics, EnrollmentRow } from './types'
import { enrollmentLedgerSearchParams, type EnrollmentLedgerQuery } from './enrollment-ledger-query'

export { parseEnrollmentLedgerQuery, type EnrollmentLedgerQuery } from './enrollment-ledger-query'

export interface EnrollmentLedger {
  items: EnrollmentRow[]
  /** Enrollments matching the query, across every page. */
  total: number
  /** What each tab holds under the other filters — the tab counters. */
  counts: { current: number; ended: number; all: number }
  page: number
  pageSize: number
  /** The whole ledger, never the filtered page. */
  metrics: EnrollmentMetrics
  /** Every language and period the ledger can hold — from the catalog, not
   * from the rows on this page. */
  filterOptions: {
    languages: string[]
    periods: { id: string; name: string }[]
  }
}

/**
 * One page of the enrollment ledger, read from `apps/api`
 * (`GET /api/v1/enrollments`). Filters, search and paging all run in Postgres:
 * the ledger reaches 20k enrollments a month in peak season (CLAUDE.md §1),
 * and a browser filtering the newest few hundred answers the wrong question.
 *
 * `null` means the API failed (error response or unreachable), never "no
 * enrollments": the page shows a visible error for it, because a silent empty
 * table is indistinguishable from an institution that sold nothing.
 */
export async function listEnrollments(query: EnrollmentLedgerQuery): Promise<EnrollmentLedger | null> {
  const search = enrollmentLedgerSearchParams(query).toString()
  try {
    const response = await apiFetch(`/api/v1/enrollments${search ? `?${search}` : ''}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}
