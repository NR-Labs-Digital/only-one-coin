import {
  DocumentKindNotFoundError,
  DocumentTemplateHasIssuesError,
  HttpError,
  TeacherNotFoundError,
  UnableToProcessEntryError,
  type IDocumentTemplateCompiler,
  type IDocumentTemplateRepository,
  type ITeacherRepository,
} from "@ooc/domain";
import { TemplateRenderError, type TemplateEngine } from "@ooc/templates";
import { PdfRenderError, type IPdfRenderer } from "@/infra/pdf/WeasyPrintRenderer.js";
import { DOCUMENT_KINDS, isDocumentKind, type DocumentKindKey } from "./documentKinds.js";
import { frameDocument } from "./frame.js";
import { teacherContractData, teacherContractKind } from "./kinds/teacherContract.js";

/** A value the template prints is empty for this record (e.g. a region left blank). */
export class DocumentMissingValueError extends UnableToProcessEntryError {
  constructor() {
    super({
      reason: "document_template.missing_value",
      message: "The template prints a value this record does not have.",
    });
  }
}

/** The template took too long or built too much — a loop gone wrong. */
export class DocumentTooHeavyError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "document_template.render_limit", message: "The template exceeded the render limits." });
  }
}

/** WeasyPrint is missing, crashed or timed out. */
export class DocumentRenderUnavailableError extends HttpError {
  constructor(cause: unknown) {
    super({ status: 503, reason: "document.render_unavailable", message: "The PDF renderer is unavailable.", cause });
  }
}

export interface PreviewInput {
  kind: string;
  /** What is in the editor right now, unsaved. Falls back to the draft, the published version, the starter text. */
  body?: string;
  /** Fill with this teacher's file instead of the sample (teacher contract only). */
  teacherId?: string;
}

/**
 * The editor's preview (OOC-123): the exact pipeline a real document goes
 * through — same engine, same frame, same WeasyPrint — so what the person sees
 * is what will be printed. Writes nothing: no document, no bucket object, no
 * audit entry. A preview issues nothing.
 */
export class DocumentPreviewService {
  constructor(
    private readonly engine: TemplateEngine,
    private readonly renderer: IPdfRenderer,
    private readonly compiler: IDocumentTemplateCompiler,
    private readonly templates: IDocumentTemplateRepository,
    private readonly teachers: ITeacherRepository,
  ) {}

  async preview(input: PreviewInput): Promise<Uint8Array> {
    if (!isDocumentKind(input.kind)) throw new DocumentKindNotFoundError();
    const body = await this.bodyFor(input.kind, input.body);
    const data = await this.dataFor(input.kind, input.teacherId);
    return this.renderPdf(input.kind, body, data);
  }

  private async bodyFor(kind: DocumentKindKey, unsaved: string | undefined): Promise<string> {
    if (unsaved !== undefined) return this.compiler.sanitize(unsaved);
    const draft = await this.templates.findDraft(kind);
    if (draft) return draft.body;
    const published = await this.templates.findPublished(kind);
    return published?.body ?? DOCUMENT_KINDS[kind].starterBody;
  }

  private async dataFor(kind: DocumentKindKey, teacherId: string | undefined): Promise<unknown> {
    const entry = DOCUMENT_KINDS[kind];
    if (!teacherId) return entry.kind.sample;

    const teacher = await this.teachers.findById(teacherId);
    if (!teacher) throw new TeacherNotFoundError();
    // A real teacher, the sample's period: the preview shows the person, the
    // dates are chosen when the contract is actually generated.
    return teacherContractData(teacher, teacherContractKind.sample.contract);
  }

  /** Engine → frame → PDF, with every failure turned into a code. Shared with real generation. */
  async renderPdf(kind: DocumentKindKey, body: string, data: unknown): Promise<Uint8Array> {
    let html: string;
    try {
      html = await this.engine.render(DOCUMENT_KINDS[kind].kind, body, data, { locale: "es-PE" });
    } catch (error) {
      if (error instanceof TemplateRenderError) {
        if (error.code === "invalid_template") throw new DocumentTemplateHasIssuesError({ cause: error });
        if (error.code === "missing_value") throw new DocumentMissingValueError();
        if (error.code === "limit_exceeded") throw new DocumentTooHeavyError();
      }
      throw error;
    }

    try {
      return await this.renderer.render(frameDocument(html));
    } catch (error) {
      if (error instanceof PdfRenderError) throw new DocumentRenderUnavailableError(error);
      throw error;
    }
  }
}
