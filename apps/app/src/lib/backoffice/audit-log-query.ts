// Client-safe on purpose: the log's filters (a client component) build their
// URLs with these, so nothing here may import the server-only `api-client`.
import {
  AUDIT_ACTION_KEYS,
  AUDIT_ENTITIES,
  type AuditActionKey,
  type AuditEntity,
  type AuditField,
} from '@ooc/domain/audit-catalog'

export type { AuditActionKey, AuditEntity, AuditField }

/** One entry of the general audit log, as `GET /api/v1/audit-log` answers it. */
export interface AuditLogEntry {
  id: string
  at: string
  action: AuditActionKey
  entity: AuditEntity | null
  /** The record the entry is about, while it exists — what the row links to. */
  subject: { entity: AuditEntity; id: string; label: string } | null
  /** Names of what changed, never the values (OOC-74). */
  fields: AuditField[]
  /** Null when the account behind the entry is gone. */
  actor: { id: string; name: string | null; role: string | null } | null
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  nextCursor: string | null
}

export interface AuditActor {
  id: string
  name: string
  role: string
}

/**
 * What the reader narrowed the log to (OOC-122). Lives in the URL
 * (`/backoffice/audit?entity=payment&from=2026-10-01`), so a filtered view
 * survives a reload and can be sent to a colleague. Empty means "all".
 */
export interface AuditLogQuery {
  /** `YYYY-MM-DD`, a calendar day in Lima. */
  from: string
  to: string
  actorId: string
  action: Exclude<AuditActionKey, 'unknown'> | ''
  entity: AuditEntity | ''
}

export const EMPTY_AUDIT_LOG_QUERY: AuditLogQuery = { from: '', to: '', actorId: '', action: '', entity: '' }

const DAY = /^\d{4}-\d{2}-\d{2}$/

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function day(value: string): string {
  if (!DAY.test(value)) return ''
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : ''
}

/**
 * Reads the filters out of the page's search params. Anything the API would
 * refuse is dropped here rather than sent: a hand-edited URL should land on
 * the unfiltered log, not on the "could not load" screen.
 */
export function parseAuditLogQuery(params: Record<string, string | string[] | undefined>): AuditLogQuery {
  const action = first(params.action)
  const entity = first(params.entity)
  const actorId = first(params.actorId)
  let from = day(first(params.from))
  let to = day(first(params.to))
  if (from && to && from > to) [from, to] = [to, from]

  return {
    from,
    to,
    actorId: actorId.length <= 100 ? actorId : '',
    action: AUDIT_ACTION_KEYS.find((key) => key === action) ?? '',
    entity: AUDIT_ENTITIES.find((key) => key === entity) ?? '',
  }
}

/** The same filters as URL search params, leaving out whatever is empty. */
export function auditLogSearchParams(query: AuditLogQuery): URLSearchParams {
  const search = new URLSearchParams()
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  if (query.actorId) search.set('actorId', query.actorId)
  if (query.action) search.set('action', query.action)
  if (query.entity) search.set('entity', query.entity)
  return search
}
