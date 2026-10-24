import type { DocumentTemplateIssue, IDocumentTemplateCompiler } from "@ooc/domain";
import { type TemplateKind, TemplateEngine } from "@ooc/templates";
import sanitizeHtml from "sanitize-html";
import { teacherContractKind, teacherContractStarterBody } from "./kinds/teacherContract.js";

/**
 * Every document the code can produce, by key (OOC-123). A kind is the engine's
 * template kind (placeholders + sample) plus the text a template starts from
 * when nobody has written one yet. Adding a document is adding an entry here,
 * its kind file and its labels in the app.
 */
export const DOCUMENT_KINDS = {
  teacher_contract: { kind: teacherContractKind, starterBody: teacherContractStarterBody },
} as const satisfies Record<string, { kind: TemplateKind; starterBody: string }>;

export type DocumentKindKey = keyof typeof DOCUMENT_KINDS;

export function isDocumentKind(key: string): key is DocumentKindKey {
  return Object.hasOwn(DOCUMENT_KINDS, key);
}

/**
 * What the editor may put in a document: text structure and emphasis, nothing
 * that loads, links or scripts. No `img`, `a`, `style`, `link` or `iframe` —
 * WeasyPrint would fetch whatever a URL points at, and a render must never
 * reach the network. The only style kept is alignment, which the editor
 * offers as a button.
 */
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr"],
  allowedAttributes: { "*": ["style"] },
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: [],
  disallowedTagsMode: "discard",
};

/** The documents subsystem's compiler port, on the project's template engine. */
export class DocumentTemplateCompiler implements IDocumentTemplateCompiler {
  constructor(private readonly engine: TemplateEngine) {}

  knows(kind: string): boolean {
    return isDocumentKind(kind);
  }

  sanitize(body: string): string {
    return sanitizeHtml(body, SANITIZE);
  }

  check(kind: string, body: string): DocumentTemplateIssue[] {
    if (!isDocumentKind(kind)) return [];
    const result = this.engine.check(DOCUMENT_KINDS[kind].kind, body);
    return result.ok ? [] : result.issues;
  }
}
