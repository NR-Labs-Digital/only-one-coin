import type { IssuedDocumentScope, RevokeFailure } from './types'

// Client-safe: the same-origin `/api/v1` proxy, never the database (CLAUDE.md §8).

/**
 * Downloads an issued document's PDF (OOC-33) and saves it as `<code>.pdf`.
 * Every download is an audited print on the API, so it is asked for on the
 * click — never prefetched. False when it did not come out.
 */
export async function downloadIssuedDocument(scope: IssuedDocumentScope, id: string, code: string): Promise<boolean> {
  const path =
    scope.kind === 'portal'
      ? `/api/v1/portal/issued-documents/${encodeURIComponent(id)}/pdf`
      : `/api/v1/issued-documents/${encodeURIComponent(id)}/pdf`
  try {
    const response = await fetch(path)
    if (!response.ok) return false
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = `${code}.pdf`
    link.click()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Revokes an issued document (OOC-59) with the reason the person typed. The
 * validation page answers "revoked" for its code from then on; it is not undone.
 */
export async function revokeIssuedDocument(id: string, reason: string): Promise<{ ok: true } | { ok: false; failure: RevokeFailure }> {
  try {
    const response = await fetch(`/api/v1/issued-documents/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    if (body?.reason === 'issued_document.revocation_reason_required') return { ok: false, failure: 'reason_required' }
    if (body?.reason === 'issued_document.already_revoked') return { ok: false, failure: 'already_revoked' }
    return { ok: false, failure: 'generic' }
  } catch {
    return { ok: false, failure: 'generic' }
  }
}
