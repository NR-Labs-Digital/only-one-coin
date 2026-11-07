import { apiFetch } from '@/lib/backoffice/api-client'
import type { AttachmentList } from './types'

/**
 * The first list, read by the page on the server (`apiFetch` forwards the
 * session). Null when the API failed: the section says so instead of claiming
 * there are no files.
 */
export async function getAttachments(
  scope: { kind: 'staff'; ownerType: 'student'; ownerId: string } | { kind: 'portal' },
): Promise<AttachmentList | null> {
  const path =
    scope.kind === 'portal'
      ? '/api/v1/portal/attachments'
      : `/api/v1/attachments?${new URLSearchParams({ ownerType: scope.ownerType, ownerId: scope.ownerId })}`
  try {
    const response = await apiFetch(path)
    if (!response.ok) return null
    return (await response.json()) as AttachmentList
  } catch {
    return null
  }
}
