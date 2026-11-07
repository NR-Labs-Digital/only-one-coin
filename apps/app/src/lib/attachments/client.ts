import type { AttachmentCategory, AttachmentFailure, AttachmentLimits, AttachmentList } from './types'

// Client-safe: every call goes through the same-origin `/api/v1` proxy, and the
// file itself straight to the bucket (CLAUDE.md §6). Nothing here talks to the
// database (CLAUDE.md §8).

/** Where a surface's attachment routes live. The panel names the owner; the
 * portal never does — the owner is the session's own student file. */
export type AttachmentScope =
  | { kind: 'staff'; ownerType: 'student'; ownerId: string }
  | { kind: 'portal' }

const baseOf = (scope: AttachmentScope) =>
  scope.kind === 'portal' ? '/api/v1/portal/attachments' : '/api/v1/attachments'

const REASONS: Record<string, AttachmentFailure> = {
  'attachment.unsupported_type': 'unsupported_type',
  'attachment.too_large': 'too_large',
  'attachment.not_uploaded': 'upload_failed',
}

async function failureOf(response: Response): Promise<AttachmentFailure> {
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  return REASONS[body?.reason ?? ''] ?? 'generic'
}

const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * The type a file will be sent as. Some browsers report a HEIC photo with an
 * empty type; the extension is the only hint then. The server checks the
 * file's own bytes either way.
 */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return ''
}

/** The client-side check, against the rules the API sent. Null = fine. */
export function checkFile(file: File, limits: AttachmentLimits): AttachmentFailure | null {
  if (!limits.contentTypes.includes(contentTypeOf(file))) return 'unsupported_type'
  if (file.size === 0 || file.size > limits.maxBytes) return 'too_large'
  return null
}

export type AttachmentUploadOutcome = { ok: true } | { ok: false; failure: AttachmentFailure }

/**
 * The three steps in order: mint a signed target (the row is born pending),
 * POST the file to the bucket, confirm (the server reads what landed). An
 * upload left halfway stays pending and is cleared by the sweep.
 */
export async function uploadAttachment(params: {
  scope: AttachmentScope
  category: AttachmentCategory
  file: File
}): Promise<AttachmentUploadOutcome> {
  const base = baseOf(params.scope)
  try {
    const target = await postJson(`${base}/uploads`, {
      ...(params.scope.kind === 'staff'
        ? { ownerType: params.scope.ownerType, ownerId: params.scope.ownerId }
        : {}),
      category: params.category,
      fileName: params.file.name,
      contentType: contentTypeOf(params.file),
      sizeBytes: params.file.size,
    })
    if (!target.ok) return { ok: false, failure: await failureOf(target) }
    const upload = (await target.json()) as {
      attachmentId: string
      uploadUrl: string
      uploadFields: Record<string, string>
    }

    const form = new FormData()
    for (const [key, value] of Object.entries(upload.uploadFields)) form.append(key, value)
    // The bucket's POST policy reads the multipart body in order: the file has
    // to be the last field.
    form.append('file', params.file)
    const uploaded = await fetch(upload.uploadUrl, { method: 'POST', body: form })
    if (!uploaded.ok) return { ok: false, failure: 'upload_failed' }

    const confirmed = await postJson(`${base}/${encodeURIComponent(upload.attachmentId)}/confirm`, {})
    if (!confirmed.ok) return { ok: false, failure: await failureOf(confirmed) }
    return { ok: true }
  } catch {
    return { ok: false, failure: 'generic' }
  }
}

/** The list again, after a change. Null when the API failed. */
export async function fetchAttachments(scope: AttachmentScope): Promise<AttachmentList | null> {
  const query =
    scope.kind === 'staff'
      ? `?${new URLSearchParams({ ownerType: scope.ownerType, ownerId: scope.ownerId })}`
      : ''
  try {
    const response = await fetch(`${baseOf(scope)}${query}`)
    if (!response.ok) return null
    return (await response.json()) as AttachmentList
  } catch {
    return null
  }
}

/**
 * A five-minute link to the file, saved under its original name. Each call is
 * a logged download on the API, so it is asked for on the click — never
 * prefetched. Null when the API refused.
 */
export async function attachmentDownloadUrl(scope: AttachmentScope, id: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseOf(scope)}/${encodeURIComponent(id)}/download`)
    if (!response.ok) return null
    return ((await response.json()) as { url: string }).url
  } catch {
    return null
  }
}

/** Takes a file off the list (panel only — soft delete on the API). */
export async function removeAttachment(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/v1/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok
  } catch {
    return false
  }
}
