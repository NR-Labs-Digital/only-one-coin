/**
 * Files sent to the platform (OOC-143), as `GET /attachments` and
 * `GET /portal/attachments` answer them. Shared by the portal and the panel:
 * the same file shows in both, with the same rules.
 *
 * Never an issued document: an uploaded file carries no verification code.
 */

/** What the file is, as the person who sent it said. Mirrors
 * `ATTACHMENT_CATEGORIES` in `packages/domain`. */
export const ATTACHMENT_CATEGORIES = ['national_id', 'guardian_consent', 'receipt', 'other'] as const
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number]

/** Where it was sent from. */
export type AttachmentSource = 'portal' | 'backoffice'

export interface AttachmentItem {
  id: string
  category: AttachmentCategory
  /** The name the person gave the file — their data, shown as is (CLAUDE.md §4). */
  originalName: string
  mimeType: string
  sizeBytes: number
  source: AttachmentSource
  uploadedAt: string
  /** Null when the account behind the upload no longer resolves to a name. */
  uploadedByName: string | null
}

/** The rules the screen checks before uploading — read from the API, never a
 * constant here (CLAUDE.md §5). */
export interface AttachmentLimits {
  maxBytes: number
  contentTypes: string[]
}

export interface AttachmentList {
  items: AttachmentItem[]
  limits: AttachmentLimits
}

/** Why a file did not go through, as something the screen can say. */
export type AttachmentFailure = 'unsupported_type' | 'too_large' | 'upload_failed' | 'generic'
