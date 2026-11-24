import { apiFetch } from './api-client'
import type { StaffProfileItem } from './permission-matrix'

/** Every live cargo and what it can do (OOC-183); `null` when it could not be read. */
export async function getStaffProfiles(): Promise<StaffProfileItem[] | null> {
  const response = await apiFetch('/api/v1/staff/permissions')
  if (!response.ok) return null
  const { items } = (await response.json()) as { items: StaffProfileItem[] }
  return items
}
