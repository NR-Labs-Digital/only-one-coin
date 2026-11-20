import type { PaymentRail } from './types'

/**
 * Buying monthly modules from the portal (OOC-86), the calls in order: mint a
 * signed target, POST the file straight to the bucket (`CLAUDE.md` §6) and
 * confirm it landed, then send the payment. Only how many modules leaves the
 * browser — always the first ones for sale — never an amount: the server
 * charges that many modules at today's price.
 */
export type MonthlySubmitFailure = 'operation_used' | 'not_for_sale' | 'receipt_rejected' | 'generic'

export type MonthlySubmitOutcome = { ok: true } | { ok: false; reason: MonthlySubmitFailure }

const REASONS: Record<string, MonthlySubmitFailure> = {
  'enrollment.operation_number_already_used': 'operation_used',
  'monthly.modules_not_for_sale': 'not_for_sale',
  'monthly.not_payable': 'not_for_sale',
  'monthly.enrollment_not_found': 'not_for_sale',
  'enrollment.receipt_not_ready': 'receipt_rejected',
}

async function failureOf(response: Response): Promise<MonthlySubmitOutcome> {
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  return { ok: false, reason: REASONS[body?.reason ?? ''] ?? 'generic' }
}

const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export async function submitMonthlyPayment(params: {
  enrollmentId: string
  moduleCount: number
  file: File
  method: PaymentRail
  operationNumber: string
  /** Minted once per attempt by the card: a retry of the same click pays once. */
  idempotencyKey: string
}): Promise<MonthlySubmitOutcome> {
  try {
    const base = `/api/v1/portal/enrollments/${encodeURIComponent(params.enrollmentId)}`

    const target = await postJson(`${base}/monthly-receipt-uploads`, { contentType: params.file.type })
    if (!target.ok) return await failureOf(target)
    const upload = (await target.json()) as {
      receiptUploadId: string
      uploadUrl: string
      uploadFields: Record<string, string>
    }

    const form = new FormData()
    for (const [key, value] of Object.entries(upload.uploadFields)) form.append(key, value)
    // The bucket's POST policy reads the multipart body in order: the file has
    // to be the last field.
    form.append('file', params.file)
    const uploaded = await fetch(upload.uploadUrl, { method: 'POST', body: form })
    if (!uploaded.ok) return { ok: false, reason: 'receipt_rejected' }

    const confirmed = await postJson(
      `${base}/monthly-receipt-uploads/${encodeURIComponent(upload.receiptUploadId)}/confirm`,
      {},
    )
    if (!confirmed.ok) return await failureOf(confirmed)

    const paid = await postJson(`${base}/monthly-payment`, {
      receiptUploadId: upload.receiptUploadId,
      method: params.method,
      operationNumber: params.operationNumber,
      moduleCount: params.moduleCount,
      idempotencyKey: params.idempotencyKey,
    })
    if (!paid.ok) return await failureOf(paid)

    return { ok: true }
  } catch {
    return { ok: false, reason: 'generic' }
  }
}
