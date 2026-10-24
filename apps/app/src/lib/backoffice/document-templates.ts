import { apiFetch } from './api-client'
import type { DocumentTemplateIssue } from './document-body'

/** The documents the code can produce — one editor each. */
export const DOCUMENT_KINDS = ['teacher_contract'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** Everything the editor opens with — `GET /document-templates/:kind`. */
export interface DocumentTemplateView {
  kind: DocumentKind
  /** The paths the API accepts; the labels are ours (`document-fields.ts`). */
  placeholders: { path: string; type: string; optional: boolean }[]
  draft: { body: string; updatedAt: string; issues: DocumentTemplateIssue[] } | null
  published: { version: number; body: string; publishedAt: string } | null
  starterBody: string
}

/**
 * One document template, read on the server (OOC-123). Null when the API
 * failed — the page shows an error state, never an empty editor that would
 * overwrite the real text on the first save.
 */
export async function getDocumentTemplate(kind: DocumentKind): Promise<DocumentTemplateView | null> {
  try {
    const response = await apiFetch(`/api/v1/document-templates/${kind}`)
    if (!response.ok) return null
    return (await response.json()) as DocumentTemplateView
  } catch {
    return null
  }
}
