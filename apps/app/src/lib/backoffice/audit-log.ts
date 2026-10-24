import { apiFetch } from './api-client'
import { auditLogSearchParams, type AuditActor, type AuditLogPage, type AuditLogQuery } from './audit-log-query'

/**
 * The first page of the general audit log (OOC-122) for the filters in the
 * URL. Later pages are fetched by the screen itself through the same-origin
 * proxy. `null` means the API failed — the screen says so instead of
 * claiming nothing happened.
 */
export async function getAuditLog(query: AuditLogQuery): Promise<AuditLogPage | null> {
  const search = auditLogSearchParams(query).toString()
  try {
    const response = await apiFetch(`/api/v1/audit-log${search ? `?${search}` : ''}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

/** Panel accounts for the author filter. Empty when the API fails — the filter just offers nobody. */
export async function getAuditActors(): Promise<AuditActor[]> {
  try {
    const response = await apiFetch('/api/v1/audit-log/actors')
    if (!response.ok) return []
    return ((await response.json()) as { items: AuditActor[] }).items
  } catch {
    return []
  }
}
