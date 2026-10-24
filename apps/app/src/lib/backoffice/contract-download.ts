// Client-safe: the ficha calls the same-origin `/api/v1` proxy, never the
// database (CLAUDE.md §8).

/** Why the contract did not come out, as something the ficha can say. */
export type ContractDocumentFailure =
  | 'not_published'
  | 'out_of_order'
  | 'missing_value'
  | 'unavailable'
  | 'failed'

/** The API's `reason`, reduced to the ficha's message — never shown as is (CLAUDE.md §4). */
function failureOf(status: number, reason: string | undefined): ContractDocumentFailure {
  if (reason === 'document_template.not_published') return 'not_published'
  if (reason === 'teacher_contract.period_out_of_order') return 'out_of_order'
  if (reason === 'document_template.missing_value') return 'missing_value'
  if (status === 503) return 'unavailable'
  return 'failed'
}

export type ContractDocumentResult = { ok: true } | { ok: false; failure: ContractDocumentFailure }

/** Saves the PDF a contract route answered with, under `fileName`. */
async function savePdf(response: Response, fileName: string): Promise<ContractDocumentResult> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, failure: failureOf(response.status, body?.reason) }
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
  return { ok: true }
}

/**
 * Generates the contract (OOC-124): the API records the period with the
 * published template version and answers the filled PDF, which is saved here.
 * The signed copy is kept outside the platform.
 */
export async function generateContract(params: {
  teacherId: string
  startsOn: string
  endsOn: string
  fileName: string
}): Promise<ContractDocumentResult> {
  try {
    const response = await fetch(
      `/api/v1/teachers/${encodeURIComponent(params.teacherId)}/contract-document`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn: params.startsOn, endsOn: params.endsOn }),
      },
    )
    return await savePdf(response, params.fileName)
  } catch {
    return { ok: false, failure: 'failed' }
  }
}

/**
 * A recorded contract printed again, from the template version it was
 * generated from. Each call is an audited print on the API, so it is asked for
 * on the click — never prefetched.
 */
export async function downloadRecordedContract(params: {
  teacherId: string
  contractId: string
  fileName: string
}): Promise<ContractDocumentResult> {
  try {
    const response = await fetch(
      `/api/v1/teachers/${encodeURIComponent(params.teacherId)}/contracts/${encodeURIComponent(params.contractId)}/document`,
    )
    return await savePdf(response, params.fileName)
  } catch {
    return { ok: false, failure: 'failed' }
  }
}

/**
 * A five-minute link to a contract filed as a PDF before OOC-124, or null.
 * Each call is an audited opening on the API, so it is asked for on the click.
 */
export async function filedContractUrl(teacherId: string, contractId: string): Promise<string | null> {
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
