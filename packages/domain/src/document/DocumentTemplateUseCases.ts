// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { DocumentTemplateDraft, DocumentTemplateIssue, DocumentTemplateVersion } from "./DocumentTemplate.js";
import { DocumentKindNotFoundError, DocumentTemplateDraftMissingError, DocumentTemplateHasIssuesError } from "./errors.js";
import type { IDocumentTemplateCompiler, IDocumentTemplateRepository } from "./ports.js";

export interface SaveDocumentTemplateDraftOutput {
  draft: DocumentTemplateDraft;
  /** What the check found — the draft is saved either way, so nothing typed is lost. */
  issues: DocumentTemplateIssue[];
}

/**
 * Saves what the person is writing (OOC-123). A draft may be wrong — half a
 * placeholder is still worth keeping — so it is sanitized and saved, and the
 * answer says what would stop it from being published. Not audited: a draft
 * issues nothing. Publishing is.
 */
export class SaveDocumentTemplateDraftUseCase extends BaseUseCase<
  { actorId: string; kind: string; body: string },
  SaveDocumentTemplateDraftOutput
> {
  constructor(
    private readonly templates: IDocumentTemplateRepository,
    private readonly compiler: IDocumentTemplateCompiler,
  ) {
    super();
  }

  async run(input: { actorId: string; kind: string; body: string }): Promise<SaveDocumentTemplateDraftOutput> {
    if (!this.compiler.knows(input.kind)) throw new DocumentKindNotFoundError();

    const body = this.compiler.sanitize(input.body);
    const draft = await this.templates.saveDraft({
      kind: input.kind,
      body,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    });

    return { draft, issues: this.compiler.check(input.kind, body) };
  }
}

/**
 * Makes the draft the text documents are issued from (OOC-123): a new,
 * numbered, immutable version. Refused while the draft does not pass the
 * check. Publishing the same text as the version in force changes nothing and
 * writes nothing.
 */
export class PublishDocumentTemplateUseCase extends BaseUseCase<
  { actorId: string; kind: string },
  DocumentTemplateVersion
> {
  constructor(
    private readonly templates: IDocumentTemplateRepository,
    private readonly compiler: IDocumentTemplateCompiler,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: { actorId: string; kind: string }): Promise<DocumentTemplateVersion> {
    if (!this.compiler.knows(input.kind)) throw new DocumentKindNotFoundError();

    const draft = await this.templates.findDraft(input.kind);
    if (!draft) throw new DocumentTemplateDraftMissingError();
    if (this.compiler.check(input.kind, draft.body).length > 0) throw new DocumentTemplateHasIssuesError();

    const current = await this.templates.findPublished(input.kind);
    if (current?.body === draft.body) return current;

    const version = await this.templates.publish({
      id: uuid(),
      kind: input.kind,
      body: draft.body,
      publishedBy: input.actorId,
    });

    await this.auditLog.append({
      actorId: input.actorId,
      action: "document_template.published",
      targetId: version.id,
      metadata: { kind: version.kind, version: version.version },
      at: version.createdAt,
    });

    return version;
  }
}
