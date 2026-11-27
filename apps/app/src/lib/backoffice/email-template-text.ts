import type { EmailLocale, EmailTemplate } from './types'

/**
 * The words of an automatic e-mail in one language (OOC-60) — the blocks the
 * API stores, with `{name}` placeholders. The screen never shows the braces:
 * each placeholder is a chip with its name from the locale files.
 */
export interface EmailCopy {
  subject: string
  preheader: string
  paragraphs: string[]
  action?: string
  item?: string
  values?: Record<string, Record<string, string>>
  missing?: string
}

export type EmailTemplateContent = Partial<Record<EmailLocale, EmailCopy>>

/** What the check found — a code and where, never a sentence (CLAUDE.md §4). */
export interface EmailTemplateIssue {
  code: string
  locale?: EmailLocale
  field?: string
  index?: number
  placeholder?: string
}

export interface EmailTemplateVersionView {
  id: string
  version: number
  content: EmailTemplateContent
  publishedAt: string
  publishedByName: string | null
  /** The repository's words changed in the code after this was published. */
  repositoryChanged: boolean
}

/** Everything the editor opens with — `GET /emails/templates/:key`. */
export interface EmailTemplateView {
  key: EmailTemplate
  placeholders: { names: string[]; itemNames: string[] }
  repository: Record<EmailLocale, EmailCopy>
  draft: {
    content: EmailTemplateContent
    updatedAt: string
    issues: EmailTemplateIssue[]
    warnings: EmailTemplateIssue[]
  } | null
  published: EmailTemplateVersionView | null
  versions: EmailTemplateVersionView[]
}

/** The `{items}` paragraph of a lot e-mail: where the list of courses goes. */
export const ITEMS_PARAGRAPH = '{items}'

/** The three languages every e-mail is written in, es-PE first (CLAUDE.md §4). */
export const EMAIL_EDITOR_LOCALES: EmailLocale[] = ['es-PE', 'pt-BR', 'en']

/* ---- `{name}` text ⇄ the chip editor's document ---------------------------- */

const PLACEHOLDER = /\{(\w+)\}/g

type InlineNode = { type: 'text'; text: string } | { type: 'placeholder'; attrs: { expression: string } }

/** The editor's document of one line: a paragraph of text and chips. */
export interface LineDoc {
  type: 'doc'
  content: [{ type: 'paragraph'; content?: InlineNode[] }]
}

/** `Hola {studentName}` → the chip editor's document. */
export function textToDoc(text: string): LineDoc {
  const content: InlineNode[] = []
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match.index > last) content.push({ type: 'text', text: text.slice(last, match.index) })
    content.push({ type: 'placeholder', attrs: { expression: match[1]! } })
    last = match.index + match[0].length
  }
  if (last < text.length) content.push({ type: 'text', text: text.slice(last) })
  return { type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] }
}

interface JsonNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

/** The chip editor's document → `Hola {studentName}`. A line break typed in is a space. */
export function docToText(doc: JsonNode): string {
  const walk = (node: JsonNode): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'placeholder') return `{${String(node.attrs?.expression ?? '')}}`
    if (node.type === 'hardBreak') return ' '
    return (node.content ?? []).map(walk).join('')
  }
  return walk(doc)
}

/** The content as the API takes it, every language in order. */
export function cloneContent(content: EmailTemplateContent): EmailTemplateContent {
  return structuredClone(content)
}
