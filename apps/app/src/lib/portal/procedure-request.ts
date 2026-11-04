import type { PaymentRail, RequestType } from './types'

/**
 * Asking for a paid procedure from the portal (OOC-83), the four calls in order:
 * open the request (which freezes the price), mint a signed target, POST the
 * file straight to the bucket (`CLAUDE.md` §6) and confirm it landed, then send
 * the payment. No amount leaves the browser: the server charges what the request
 * froze. Opening again reuses a request still waiting for its receipt, so an
 * attempt that failed halfway is picked up by trying again.
 */
export type ProcedureSubmitFailure = 'operation_used' | 'already_open' | 'receipt_rejected' | 'generic'

export type ProcedureSubmitOutcome = { ok: true } | { ok: false; reason: ProcedureSubmitFailure }

const REASONS: Record<string, ProcedureSubmitFailure> = {
  'enrollment.operation_number_already_used': 'operation_used',
  'procedure.already_open': 'already_open',
  'procedure.not_payable': 'already_open',
  'enrollment.receipt_not_ready': 'receipt_rejected',
}

async function failureOf(response: Response): Promise<ProcedureSubmitOutcome> {
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  return { ok: false, reason: REASONS[body?.reason ?? ''] ?? 'generic' }
}

const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export async function submitProcedureRequest(params: {
  kind: RequestType
  enrollmentId: string
  file: File
  method: PaymentRail
  operationNumber: string
  /** Minted once per attempt by the form: a retry of the same click pays once. */
  idempotencyKey: string
}): Promise<ProcedureSubmitOutcome> {
  try {
    const opened = await postJson('/api/v1/portal/procedure-requests', {
      kind: params.kind,
      enrollmentId: params.enrollmentId,
    })
    if (!opened.ok) return await failureOf(opened)
    const { id } = (await opened.json()) as { id: string }
    const base = `/api/v1/portal/procedure-requests/${encodeURIComponent(id)}`

    const target = await postJson(`${base}/receipt-uploads`, { contentType: params.file.type })
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
      `${base}/receipt-uploads/${encodeURIComponent(upload.receiptUploadId)}/confirm`,
      {},
    )
    if (!confirmed.ok) return await failureOf(confirmed)

    const paid = await postJson(`${base}/payment`, {
      receiptUploadId: upload.receiptUploadId,
      method: params.method,
      operationNumber: params.operationNumber,
      idempotencyKey: params.idempotencyKey,
    })
    if (!paid.ok) return await failureOf(paid)

    return { ok: true }
  } catch {
    return { ok: false, reason: 'generic' }
  }
}
