import type { RejectionReason } from './types'

/** What a failed payment call can say, as the locale names it. */
export type PaymentErrorKey =
  | 'already_settled'
  | 'seat_released'
  | 'not_found'
  | 'receipt_not_found'
  | 'reread_in_progress'
  | 'receipt_not_rereadable'
  | 'generic'

export type PaymentWriteResult<T> = { ok: true; data: T } | { ok: false; error: PaymentErrorKey }

const KNOWN: ReadonlySet<PaymentErrorKey> = new Set<PaymentErrorKey>([
  'already_settled',
  'seat_released',
  'not_found',
  'receipt_not_found',
  'reread_in_progress',
  'receipt_not_rereadable',
])

/** `payment.already_settled` → `already_settled`; anything unknown → `generic`. */
export function paymentErrorKey(reason: string | undefined): PaymentErrorKey {
  const key = reason?.startsWith('payment.') ? reason.slice('payment.'.length) : undefined
  return key && KNOWN.has(key as PaymentErrorKey) ? (key as PaymentErrorKey) : 'generic'
}

/**
 * One payment call through the same-origin proxy. The API answers the
 * project's error envelope `{status, reason}` (docs/ARCHITECTURE.md §5.7);
 * this turns it into a key the locale can say.
 */
async function paymentCall<T>(
  path: string,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
): Promise<PaymentWriteResult<T>> {
  try {
    const response = await fetch(
      `/api/v1/payments/${path}`,
      init.method === 'GET'
        ? { method: 'GET' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // The settle routes validate a JSON object even when it carries
            // nothing: an empty body is a 400, so approve still sends `{}`.
            body: JSON.stringify(init.body),
          },
    )
    if (response.ok) return { ok: true, data: (await response.json()) as T }
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, error: paymentErrorKey(failure?.reason) }
  } catch {
    return { ok: false, error: 'generic' }
  }
}

/** Approve an open payment: the seat is confirmed and the enrollment finished. */
export async function approvePayment(
  id: string,
): Promise<
  PaymentWriteResult<{
    id: string
    portalAccess: 'created' | 'linked_existing' | 'already_linked' | 'email_conflict' | null
  }>
> {
  return paymentCall(`${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} })
}

/** Reject an open payment: the seat goes back to the class group. */
export async function rejectPayment(
  id: string,
  reason: RejectionReason,
  note: string,
): Promise<PaymentWriteResult<{ id: string }>> {
  return paymentCall(`${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { reason, note },
  })
}

/**
 * A short-lived signed URL to the receipt image. Every call is an audited read
 * on the server, so it is asked for only when a reviewer opens the receipt —
 * never ahead of time for the list.
 */
/**
 * Asks for a new OCR reading of the payment's receipt (Sessão 32). The API
 * only queues it: the reading and its verdict show up in the queue once the
 * worker answers. Never changes the payment's status.
 */
export async function rereadReceipt(id: string): Promise<PaymentWriteResult<{ rereadId: string }>> {
  return paymentCall(`${encodeURIComponent(id)}/reread`, { method: 'POST', body: {} })
}

export async function fetchReceiptUrl(id: string): Promise<PaymentWriteResult<{ url: string }>> {
  return paymentCall(`${encodeURIComponent(id)}/receipt`, { method: 'GET' })
}
