import type { AuditActionKey } from './audit-log-query'

/** The staff cargos `bo.role` names. */
const STAFF_ROLES = new Set([
  'master',
  'admin',
  'analyst',
  'enrollment_supervisor',
  'academic_supervisor',
  'teacher',
  'sales',
  'support',
  'billing',
])

type Translate = (key: string) => string

/**
 * The author's cargo in words. A student writes entries too (setting their
 * portal password); anything else unknown is left blank rather than shown as
 * a code (CLAUDE.md §4).
 */
export function auditRoleLabel(t: Translate, role: string | null): string | null {
  if (!role) return null
  if (STAFF_ROLES.has(role)) return t(`role.${role}`)
  return role === 'student' ? t('audit_log.role_student') : null
}

export function auditActionLabel(t: Translate, action: AuditActionKey): string {
  return t(`audit_log.action.${action}`)
}
