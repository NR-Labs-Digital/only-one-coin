/**
 * The two shapes of a document's text (OOC-123). Stored, the body is HTML with
 * Liquid placeholders — `<p>Yo, {{ teacher.fullName }}…</p>` — which is what
 * the API checks, versions and prints. In the editor each placeholder is a
 * chip, an atom the person picks from a list and can only move or delete
 * whole: `<span data-placeholder="teacher.fullName"></span>`. These two
 * functions translate between them, and nothing else does.
 *
 * Anything else written in Liquid (`{% if %}` from somebody who knows it)
 * stays as plain text in the editor and reaches the API untouched.
 */

/** One problem the API found in a body — `DocumentTemplateIssueSchema`. */
export interface DocumentTemplateIssue {
  code: string
  line?: number
  column?: number
  variable?: string
  filter?: string
}

const OUTPUT = /\{\{\s*([\s\S]+?)\s*\}\}/g
const CHIP = /<span\b[^>]*\bdata-placeholder="([^"]*)"[^>]*>[\s\S]*?<\/span>/g

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Stored body → the editor's HTML, every `{{ … }}` turned into a chip. */
export function bodyToEditorHtml(body: string): string {
  return body.replace(
    OUTPUT,
    (_match, expression: string) => `<span data-placeholder="${escapeAttribute(expression.trim())}"></span>`,
  )
}

/** The editor's HTML → the body the API stores, every chip turned back into `{{ … }}`. */
export function editorHtmlToBody(html: string): string {
  return html.replace(CHIP, (_match, expression: string) => `{{ ${unescapeAttribute(expression)} }}`)
}
