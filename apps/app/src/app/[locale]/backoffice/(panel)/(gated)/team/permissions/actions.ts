'use server'

import { getStaffSession } from '@/lib/backoffice/session'
import { canManageStaff } from '@/lib/backoffice/permissions'
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  CONFIGURABLE_ROLES,
  type CapabilityKey,
} from '@/lib/backoffice/capabilities'
import {
  resetAllCapabilities,
  setCapabilityRole,
} from '@/lib/backoffice/role-permissions'

/**
 * The two writes of the permissions matrix.
 *
 * Both read the cargo of the signed-in account from the session rather than
 * taking anything the form says about who is asking, and both refuse a
 * capability or a cargo that is not in the catalog — nothing that arrives from
 * the client is trusted as an id (CLAUDE.md §8). The gate here is the same one
 * the screen draws itself with; when the API exists it becomes the role
 * declared on `PUT /api/v1/role-permissions/:capability`, and that one is the
 * check that counts.
 *
 * The result carries every capability the call moved — the requested one plus
 * whatever its dependencies dragged along — so the screen can say what else
 * went with the click instead of the reader finding out later.
 */
export async function setRolePermission(
  capability: string,
  role: string,
  allowed: boolean,
): Promise<{ ok: boolean; moved: string[] }> {
  const staff = await getStaffSession()
  if (!canManageStaff(staff.role)) return { ok: false, moved: [] }

  const key = CAPABILITY_KEYS.find((candidate) => candidate === capability)
  if (!key) return { ok: false, moved: [] }
  if (CAPABILITIES[key].locked) return { ok: false, moved: [] }

  /* A cargo outside this list is either management — always on, by
     construction — or not a cargo at all. Either way there is nothing to
     write, and refusing is better than storing a row nobody asked for. */
  const target = CONFIGURABLE_ROLES.find((candidate) => candidate === role)
  if (!target) return { ok: false, moved: [] }

  const moved: CapabilityKey[] = setCapabilityRole(key, target, allowed)

  return { ok: true, moved }
}

/** Put every capability back to what the catalog declares. */
export async function restoreDefaultPermissions(): Promise<{ ok: boolean }> {
  const staff = await getStaffSession()
  if (!canManageStaff(staff.role)) return { ok: false }

  resetAllCapabilities()

  return { ok: true }
}
