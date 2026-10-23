import { apiFetch } from './api-client'
import type { PaymentMetrics, PaymentReviewQueue, PaymentRow } from './types'
import {
  paymentLedgerSearchParams,
  reviewQueueSearchParams,
  type PaymentLedgerQuery,
  type ReviewQueueQuery,
} from './payment-ledger-query'

export {
  parsePaymentLedgerQuery,
  parseReviewQueueQuery,
  type PaymentLedgerQuery,
  type ReviewQueueQuery,
} from './payment-ledger-query'

export interface PaymentLedger {
  items: PaymentRow[]
  /** Payments matching the query, across every page. */
  total: number
  /** What each tab holds under the other filters — the tab counters. */
  counts: { open: number; closed: number }
  page: number
  pageSize: number
  /** The current period, never the filtered page. */
  metrics: PaymentMetrics
}

/** GET a list endpoint; `null` on an error response or an unreachable API. */
async function readList<T>(path: string, search: URLSearchParams): Promise<T | null> {
  const query = search.toString()
  try {
    const response = await apiFetch(`${path}${query ? `?${query}` : ''}`)
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * One page of the payment ledger, read from `apps/api`
 * (`GET /api/v1/payments`). Filters, search and paging all run in Postgres:
 * up to 20k receipts a month in peak season (CLAUDE.md §1) is not a list a
 * browser can filter.
 *
 * `null` means the API failed, never "no payments": the page shows a visible
 * error for it, because a silent empty table reads as a period that collected
 * nothing.
 */
export async function listPayments(query: PaymentLedgerQuery): Promise<PaymentLedger | null> {
  return readList<PaymentLedger>('/api/v1/payments', paymentLedgerSearchParams(query))
}

/**
 * One page of the review queue (`GET /api/v1/payments/review`): every payment
 * still owed a decision, oldest first. Same contract as `listPayments` — a
 * search under the API's floor is dropped rather than sent (by
 * `parseReviewQueueQuery`), and `null` is a failure, never an empty queue.
 */
export async function listPaymentReviewQueue(
  query: ReviewQueueQuery,
): Promise<PaymentReviewQueue | null> {
  return readList<PaymentReviewQueue>('/api/v1/payments/review', reviewQueueSearchParams(query))
}
