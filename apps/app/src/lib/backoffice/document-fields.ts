import type { DocumentKind } from './document-templates'

/**
 * The data a person can drop into a document, as the editor offers it
 * (OOC-123). Whoever edits never types `{{ teacher.fullName }}`: they pick
 * "Nombre completo" from a list, and the editor stores the expression.
 *
 * `expression` is what lands in the template: dates go through `local_date`
 * so they print "1 de noviembre de 2026", and an optional value carries a
 * `default` so an empty one prints a dash instead of refusing the document.
 * The label of each field lives in the locale files under
 * `documents.fields.<path>` — this file only knows the paths.
 */
export interface DocumentField {
  /** The placeholder path, as the API lists it. */
  path: string
  expression: string
}

export interface DocumentFieldGroup {
  /** `documents.groups.<key>` in the locale files. */
  key: string
  fields: DocumentField[]
}

const text = (path: string): DocumentField => ({ path, expression: path })
const date = (path: string): DocumentField => ({ path, expression: `${path} | local_date` })
const optional = (path: string): DocumentField => ({ path, expression: `${path} | default: "—"` })

export const DOCUMENT_FIELDS: Record<DocumentKind, DocumentFieldGroup[]> = {
  teacher_contract: [
    {
      key: 'teacher',
      fields: [
        text('teacher.fullName'),
        text('teacher.firstName'),
        text('teacher.lastName'),
        text('teacher.documentType'),
        text('teacher.nationalId'),
        text('teacher.nationality'),
        text('teacher.email'),
        text('teacher.phone'),
        text('teacher.address'),
        text('teacher.city'),
        optional('teacher.region'),
        text('teacher.country'),
        text('teacher.languages'),
      ],
    },
    {
      key: 'contract',
      fields: [date('contract.startsOn'), date('contract.endsOn'), date('issuedOn')],
    },
    {
      key: 'org',
      fields: [text('org.legalName'), text('org.ruc'), text('org.address')],
    },
  ],
}

/** The path a stored expression prints — `teacher.region | default: "—"` → `teacher.region`. */
export function pathOfExpression(expression: string): string {
  return expression.split('|')[0]!.trim()
}

/** The field an expression stands for, when the editor knows it. */
export function fieldOfExpression(kind: DocumentKind, expression: string): DocumentField | null {
  const path = pathOfExpression(expression)
  for (const group of DOCUMENT_FIELDS[kind]) {
    const field = group.fields.find((candidate) => candidate.path === path)
    if (field) return field
  }
  return null
}
