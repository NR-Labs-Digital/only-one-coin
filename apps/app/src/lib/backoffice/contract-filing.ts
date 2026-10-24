// Client-safe: the ficha calls the same-origin `/api/v1` proxy and the bucket,
// never the database (CLAUDE.md §8).

import type { FieldErrorCode } from '@ooc/domain/fields'
import { parseFieldErrors } from '@/lib/field-errors'

/** The fields of the filing form a refusal can name. */
export type ContractField = 'fileName' | 'startsOn' | 'endsOn'

/**
 * Why filing failed, as something the form can say — never the API's `reason`
 * carried into the markup (CLAUDE.md §4).
 */
export type ContractFilingFailure =
  | { kind: 'not_pdf' }
  | { kind: 'too_large'; maxBytes: number }
  | { kind: 'invalid'; fields: Partial<Record<ContractField, FieldErrorCode>> }
  | { kind: 'generic' }

export type ContractFilingResult = { ok: true } | { ok: false; failure: ContractFilingFailure }

/**
 * The three calls behind "file a contract" (OOC-81): an upload target from the
 * API, the PDF straight to the bucket — never through a function of ours
 * (CLAUDE.md §6) — and the filing with the period it covers. The API checks the
 * bytes; the type and size checks here only spare a pointless upload.
 */
export async function fileContract(params: {
  teacherId: string
  file: File
  startsOn: string
  endsOn: string
}): Promise<ContractFilingResult> {
  const base = `/api/v1/teachers/${encodeURIComponent(params.teacherId)}`
  if (params.file.type !== 'application/pdf') return { ok: false, failure: { kind: 'not_pdf' } }

  try {
    const target = await fetch(`${base}/contract-uploads`, { method: 'POST' })
    if (!target.ok) return { ok: false, failure: { kind: 'generic' } }
    const body = (await target.json()) as {
      contractUploadId: string
      uploadUrl: string
      uploadFields: Record<string, string>
      maxBytes: number
    }
    if (params.file.size > body.maxBytes) {
      return { ok: false, failure: { kind: 'too_large', maxBytes: body.maxBytes } }
    }

    const form = new FormData()
    for (const [key, value] of Object.entries(body.uploadFields)) form.append(key, value)
    // The bucket's POST policy reads the body in order — the file goes last.
    form.append('file', params.file)
    const uploaded = await fetch(body.uploadUrl, { method: 'POST', body: form })
    if (!uploaded.ok) return { ok: false, failure: { kind: 'generic' } }

    const filed = await fetch(`${base}/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractUploadId: body.contractUploadId,
        contract: { fileName: params.file.name, startsOn: params.startsOn, endsOn: params.endsOn },
      }),
    })
    if (filed.ok) return { ok: true }

    const failure = (await filed.json().catch(() => null)) as { reason?: string } | null
    if (failure?.reason === 'teacher_contract.invalid_file') return { ok: false, failure: { kind: 'not_pdf' } }
    const fields = parseFieldErrors(failure)
    if (fields.length > 0) {
      return {
        ok: false,
        failure: {
          kind: 'invalid',
          fields: Object.fromEntries(
            fields.map((field) => [field.path.replace(/^contract\./, ''), field.code]),
          ),
        },
      }
    }
    return { ok: false, failure: { kind: 'generic' } }
  } catch {
    return { ok: false, failure: { kind: 'generic' } }
  }
}

/**
 * A five-minute link to one filed contract, or null. Each call is an audited
 * opening on the API, so it is asked for on the click — never prefetched.
 */
export async function contractDownloadUrl(teacherId: string, contractId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/v1/teachers/${encodeURIComponent(teacherId)}/contracts/${encodeURIComponent(contractId)}/file`,
    )
    if (!response.ok) return null
    const body = (await response.json()) as { url: string }
    return body.url
  } catch {
    return null
  }
}
