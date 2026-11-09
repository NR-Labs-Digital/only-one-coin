/**
 * The manual enrollment's receipt (OOC-146) — mandatory, and the same three
 * calls as the checkout's (`lib/enrollment/receipt-upload.ts`): mint a signed
 * target (`POST /enrollments/receipt-uploads`), POST the file straight to the
 * bucket — never through `apps/api`'s own function (`CLAUDE.md` §6) — and
 * confirm it landed. The upload belongs to the signed-in staff account until
 * `POST /enrollments` attaches it to the payment, so no id is sent along.
 *
 * Client-safe: it runs in the browser, through the app's same-origin proxy.
 */

/** Browser-side filter only — the real gate is magic bytes in the normalize
 * worker. The list the API signs an upload for (`RECEIPT_CONTENT_TYPES`). */
export const MANUAL_RECEIPT_ACCEPT = 'image/jpeg,image/png,image/heic,image/heif'
export const MANUAL_RECEIPT_TYPES: ReadonlySet<string> = new Set(MANUAL_RECEIPT_ACCEPT.split(','))

/** Below the API's signed limit (`RECEIPT_MAX_UPLOAD_BYTES`), same as the
 * portal's receipt form: a receipt is a phone photo or a screenshot. */
export const MANUAL_RECEIPT_MAX_BYTES = 10_000_000

export type ManualReceiptUploadOutcome = { ok: true; receiptUploadId: string } | { ok: false }

export async function uploadManualReceipt(file: File): Promise<ManualReceiptUploadOutcome> {
  try {
    const target = await fetch('/api/v1/enrollments/receipt-uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type }),
    })
    if (!target.ok) return { ok: false }

    const body = (await target.json()) as {
      receiptUploadId: string
      uploadUrl: string
      uploadFields: Record<string, string>
    }

    const form = new FormData()
    for (const [key, value] of Object.entries(body.uploadFields)) form.append(key, value)
    // The bucket's POST policy reads the multipart body in order — the file
    // has to be the last field.
    form.append('file', file)

    const uploaded = await fetch(body.uploadUrl, { method: 'POST', body: form })
    if (!uploaded.ok) return { ok: false }

    const confirmed = await fetch(
      `/api/v1/enrollments/receipt-uploads/${encodeURIComponent(body.receiptUploadId)}/confirm`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    )
    if (!confirmed.ok) return { ok: false }

    return { ok: true, receiptUploadId: body.receiptUploadId }
  } catch {
    return { ok: false }
  }
}
