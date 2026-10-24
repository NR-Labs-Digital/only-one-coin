import { z } from "zod";
import { BaseModel, BaseModelPropsSchema } from "../shared/base/BaseModel.js";

/**
 * Editable document templates (OOC-123): the text of a document — a teacher
 * contract today, constancia and certificate later — written in the backoffice
 * and filled by the code. Two shapes, on purpose:
 *
 * - the **draft** is a workbench: one per kind, rewritten on every save, and
 *   allowed to be wrong (a placeholder half-typed is still worth keeping);
 * - a **version** is what documents are issued from: append-only, numbered,
 *   and only born from a draft that passes the check. A document generated
 *   from version 3 keeps saying so after version 4 is published.
 *
 * The kinds themselves (their placeholders, sample data and the fixed frame
 * around the text) live in `apps/api`, next to the engine that renders them.
 */
export interface DocumentTemplateDraft {
  kind: string;
  /** Rich text from the editor, already sanitized: HTML with Liquid placeholders. */
  body: string;
  updatedBy: string;
  updatedAt: Date;
}

export const DocumentTemplateVersionPropsSchema = BaseModelPropsSchema.extend({
  kind: z.string().min(1),
  version: z.number().int().positive(),
  body: z.string(),
  publishedBy: z.string().min(1),
});

export type DocumentTemplateVersionProps = z.infer<typeof DocumentTemplateVersionPropsSchema>;

/** A published version. Append-only, like its table: there is nothing on it to change. */
export class DocumentTemplateVersion extends BaseModel {
  public readonly kind: string;
  public readonly version: number;
  public readonly body: string;
  public readonly publishedBy: string;

  constructor(props: DocumentTemplateVersionProps) {
    super(props);
    this.kind = props.kind;
    this.version = props.version;
    this.body = props.body;
    this.publishedBy = props.publishedBy;
  }
}

/**
 * What a check found wrong with a template, as the template engine reports it
 * (`@ooc/templates`): a code and where, never a sentence (CLAUDE.md §4).
 */
export interface DocumentTemplateIssue {
  code: string;
  line?: number;
  column?: number;
  variable?: string;
  filter?: string;
}
