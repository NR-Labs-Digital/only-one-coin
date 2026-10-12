// Client-safe on purpose: the ledger screen (a client component) builds its
// URLs with these, so nothing here may import the server-only `api-client`.

import type { PaymentMethod, PaymentStatus } from './types'

/**
 * What the reader narrowed the payment ledger to. Lives in the URL
 * (`/backoffice/payments?status=approved&page=3`), so a filtered view survives
 * a reload and can be sent to a colleague as a link.
 */
export interface PaymentLedgerQuery {
  page: number
  /** The tab (OOC-114). Opens on `open`: what still needs a decision. */
  state: PaymentLedgerState
  /** Narrows within the tab — always one of `statusesOf(state)`. */
  status: PaymentStatus | null
  method: PaymentMethod | null
  q: string
  sort: 'newest' | 'oldest'
}

/** The states as they are worked, not alphabetically: open ones first. */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'under_review',
  'pending',
  'approved',
  'rejected',
]

export type PaymentLedgerState = 'open' | 'closed' | 'all'

/** Tab order on screen; the first is the default. */
export const PAYMENT_LEDGER_STATES: readonly PaymentLedgerState[] = ['open', 'closed', 'all']

/** The fine statuses a tab holds — the only ones its status filter offers. */
export function statusesOf(state: PaymentLedgerState): readonly PaymentStatus[] {
  if (state === 'open') return PAYMENT_STATUSES.filter((s) => s === 'under_review' || s === 'pending')
  if (state === 'closed') return PAYMENT_STATUSES.filter((s) => s === 'approved' || s === 'rejected')
  return PAYMENT_STATUSES
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'yape',
  'plin',
  'bcp',
  'interbank',
  'other',
]

/** Mirrors the API's floor on `q` — shorter than this is no search at all. */
export const MIN_SEARCH_LENGTH = 2

/** The API's ceiling on `q`. */
const MAX_SEARCH_LENGTH = 100

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function oneOf<T extends string>(options: readonly T[], value: string | undefined): T | null {
  return options.find((option) => option === value) ?? null
}

/**
 * Reads the ledger query out of the page's search params. Anything the API
 * would refuse is dropped here rather than sent: a hand-edited URL should land
 * on the unfiltered ledger, not on the "could not load" screen.
 */
export function parsePaymentLedgerQuery(
  params: Record<string, string | string[] | undefined>,
): PaymentLedgerQuery {
  const page = Number.parseInt(first(params.page) ?? '', 10)
  const q = first(params.q)?.trim() ?? ''
  const state = oneOf(PAYMENT_LEDGER_STATES, first(params.state)) ?? 'open'

  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    state,
    // A status outside the tab (`?state=open&status=approved`) would be an
    // empty list that looks like a fact; it is dropped instead.
    status: oneOf(statusesOf(state), first(params.status)),
    method: oneOf(PAYMENT_METHODS, first(params.method)),
    q: q.length >= MIN_SEARCH_LENGTH && q.length <= MAX_SEARCH_LENGTH ? q : '',
    sort: first(params.sort) === 'oldest' ? 'oldest' : 'newest',
  }
}

/** The same query as URL search params, leaving out whatever is the default. */
export function paymentLedgerSearchParams(query: PaymentLedgerQuery): URLSearchParams {
  const search = new URLSearchParams()
  if (query.page > 1) search.set('page', String(query.page))
  if (query.state !== 'open') search.set('state', query.state)
  if (query.status) search.set('status', query.status)
  if (query.method) search.set('method', query.method)
  if (query.q) search.set('q', query.q)
  if (query.sort !== 'newest') search.set('sort', query.sort)
  return search
}

/**
 * What the reader narrowed the review queue to. The queue has one order —
 * oldest first, the order it is worked in — so only search and page travel.
 */
export interface ReviewQueueQuery {
  page: number
  q: string
}

/** Same rules as the ledger: whatever the API would refuse is dropped. */
export function parseReviewQueueQuery(
  params: Record<string, string | string[] | undefined>,
): ReviewQueueQuery {
  const { page, q } = parsePaymentLedgerQuery(params)
  return { page, q }
}

export function reviewQueueSearchParams(query: ReviewQueueQuery): URLSearchParams {
  const search = new URLSearchParams()
  if (query.page > 1) search.set('page', String(query.page))
  if (query.q) search.set('q', query.q)
  return search
}

/**
 * The queue link that opens one payment's case. `?receipt=` alone only works
 * when the payment is on the queue's first page; the search narrows the queue
 * to it first, by what the API's `q` matches — the operation number when the
 * student declared one, the student's name otherwise.
 */
export function reviewCaseSearchParams(payment: {
  id: string
  operationNumber: string | null
  studentName: string
}): URLSearchParams {
  const search = new URLSearchParams()
  const operation = payment.operationNumber?.trim() ?? ''
  const needle = operation.length >= MIN_SEARCH_LENGTH ? operation : payment.studentName.trim()
  if (needle.length >= MIN_SEARCH_LENGTH && needle.length <= MAX_SEARCH_LENGTH) search.set('q', needle)
  search.set('receipt', payment.id)
  return search
}
