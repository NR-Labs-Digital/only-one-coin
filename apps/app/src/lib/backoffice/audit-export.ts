import { CSV_BOM, csvLine, ndjsonToCsv } from './csv'
import type { AuditActionKey, AuditEntity, AuditField, AuditLogEntry } from './audit-log-query'
import { formatSpreadsheetDateTime } from '@/lib/format'

/**
 * The general audit log as a CSV (OOC-122). `apps/api` picks the entries — the
 * filters the screen shows, every page — records the export in the log
 * itself, and sends one entry per line; this module writes them in the
 * reader's language. Every word comes from the locale (CLAUDE.md §4), never
 * an action code, and every cell goes through `csvCell`: names were typed by
 * people outside the panel (CLAUDE.md §8, CSV injection).
 */
export const AUDIT_EXPORT_COLUMNS = ['date', 'action', 'entity', 'subject', 'fields', 'actor', 'actor_role'] as const

export type AuditExportColumn = (typeof AUDIT_EXPORT_COLUMNS)[number]

export interface AuditExportLabels {
  column: (key: AuditExportColumn) => string
  action: (key: AuditActionKey) => string
  entity: (key: AuditEntity) => string
  field: (key: AuditField) => string
  role: (role: string) => string
  /** For an author whose account no longer exists. */
  unknownActor: string
}

export function auditExportHeader(labels: AuditExportLabels): string {
  return `${CSV_BOM}${csvLine(AUDIT_EXPORT_COLUMNS.map(labels.column))}`
}

export function auditExportLine(entry: AuditLogEntry, labels: AuditExportLabels): string {
  const cells: Record<AuditExportColumn, string | null> = {
    date: formatSpreadsheetDateTime(entry.at),
    action: labels.action(entry.action),
    entity: entry.entity ? labels.entity(entry.entity) : null,
    subject: entry.subject?.label ?? null,
    fields: entry.fields.map(labels.field).join('; ') || null,
    actor: entry.actor?.name ?? labels.unknownActor,
    actor_role: entry.actor?.role ? labels.role(entry.actor.role) : null,
  }
  return csvLine(AUDIT_EXPORT_COLUMNS.map((key) => cells[key]))
}

/** The API's NDJSON as the CSV the reader downloads. */
export function ndjsonToAuditCsv(
  source: ReadableStream<Uint8Array>,
  labels: AuditExportLabels,
): ReadableStream<Uint8Array> {
  return ndjsonToCsv<AuditLogEntry>(source, auditExportHeader(labels), (entry) => auditExportLine(entry, labels))
}
