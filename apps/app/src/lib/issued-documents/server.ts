import { apiFetch } from '@/lib/backoffice/api-client'
import { withProfile } from '@/lib/portal/profile'
import type { IssuedDocumentItem, IssuedDocumentScope } from './types'

/**
 * The issued documents, read by the page on the server (OOC-33). Null when the
 * API failed: the list says so instead of claiming there are none.
 */
export async function getIssuedDocuments(scope: IssuedDocumentScope): Promise<IssuedDocumentItem[] | null> {
  const path =
    scope.kind === 'portal'
      ? await withProfile('/api/v1/portal/issued-documents')
      : `/api/v1/students/${encodeURIComponent(scope.studentId)}/issued-documents`
  try {
    const response = await apiFetch(path)
    if (!response.ok) return null
    return ((await response.json()) as { items: IssuedDocumentItem[] }).items
  } catch {
    return null
  }
}
