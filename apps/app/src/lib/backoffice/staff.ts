import { apiFetch } from './api-client'
import type { InvitableTeacher, StaffMemberRow, StaffRoleChange } from './types'

/** The team directory: real accounts plus invites still waiting on the person. */
export async function listStaff(): Promise<StaffMemberRow[]> {
  const response = await apiFetch('/api/v1/staff')
  if (!response.ok) return []
  const { items } = (await response.json()) as { items: StaffMemberRow[] }
  return items
}

/** The cargo ledger — reads `audit_log`, never edits it. */
export async function listStaffRoleChanges(): Promise<StaffRoleChange[]> {
  const response = await apiFetch('/api/v1/staff/role-changes')
  if (!response.ok) return []
  const { items } = (await response.json()) as { items: StaffRoleChange[] }
  return items
}

/** Teacher files that can still receive a panel account — the invite form's picker (OOC-79). */
export async function listInvitableTeachers(): Promise<InvitableTeacher[]> {
  const response = await apiFetch('/api/v1/staff/invites/teacher-options')
  if (!response.ok) return []
  const { items } = (await response.json()) as { items: InvitableTeacher[] }
  return items
}
