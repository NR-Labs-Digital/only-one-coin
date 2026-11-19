/**
 * A document the institution issued (OOC-33), as `GET /students/:id/issued-documents`
 * and `GET /portal/issued-documents` answer it. Never a file anybody uploaded:
 * this one carries a verification code. Mirrors `ISSUED_DOCUMENT_KINDS` in
 * `packages/domain`.
 */
export const ISSUED_DOCUMENT_KINDS = ['enrollment_certificate', 'certificate'] as const
export type IssuedDocumentKind = (typeof ISSUED_DOCUMENT_KINDS)[number]

export interface IssuedDocumentItem {
  id: string
  kind: IssuedDocumentKind
  /** The verification code — the document's, shown as is. */
  code: string
  /** Catalog data, allowed on screen (CLAUDE.md §4). */
  courseName: string
  issuedAt: string
}

/** Where a surface reads its issued documents: the panel names the student,
 * the portal never does — it is the chosen profile (OOC-147). */
export type IssuedDocumentScope = { kind: 'staff'; studentId: string } | { kind: 'portal' }
