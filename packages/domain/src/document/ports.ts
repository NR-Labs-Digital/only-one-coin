import type { DocumentTemplateDraft, DocumentTemplateIssue, DocumentTemplateVersion } from "./DocumentTemplate.js";

export interface IDocumentTemplateRepository {
  findDraft(kind: string): Promise<DocumentTemplateDraft | null>;

  /** One draft per kind: writes over the previous one. */
  saveDraft(draft: DocumentTemplateDraft): Promise<DocumentTemplateDraft>;

  /** The version documents are issued from now — the highest number. */
  findPublished(kind: string): Promise<DocumentTemplateVersion | null>;

  /**
   * Appends the next version of `kind` (1 + the highest) with `body`.
   * Concurrent publishes never get the same number — the unique index on
   * (kind, version) is the guarantee.
   */
  publish(params: { id: string; kind: string; body: string; publishedBy: string }): Promise<DocumentTemplateVersion>;
}

/**
 * What the documents subsystem knows about kinds and their text — implemented
 * in `apps/api` with the template engine and the HTML sanitizer, so the domain
 * stays library-free.
 */
export interface IDocumentTemplateCompiler {
  /** Whether `kind` is a document the code can produce. */
  knows(kind: string): boolean;

  /** The editor's HTML cut down to the tags and attributes a document may carry. */
  sanitize(body: string): string;

  /** Everything wrong with `body` for `kind`; empty when it can be published. */
  check(kind: string, body: string): DocumentTemplateIssue[];
}
