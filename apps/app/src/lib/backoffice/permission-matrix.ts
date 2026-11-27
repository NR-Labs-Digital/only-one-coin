import { BOARD_ROLES, type BoardRole, type PermissionArea, type PermissionKey } from '@ooc/domain/permission-catalog'
import type { CustomCargo } from './cargos'

/**
 * A cargo as `GET /staff/permissions` answers it (OOC-57, OOC-183): what it
 * can really do, read the way the API's authorization hook reads it, and
 * whether the account asking may edit it — the same rules the write checks.
 */
export interface StaffProfileItem {
  id: string
  /** A board cargo; null for one created in Equipo, which has `name`. */
  role: BoardRole | null
  name: string | null
  permissions: PermissionKey[]
  /** Master and teacher: never edited on the screen. */
  locked: boolean
  mfaRequired: boolean
  /** Accounts on the cargo, and invites still waiting on the person. */
  members: number
  editable: boolean
}

/** Whether a cargo holds a permission. */
export function profileHolds(profile: Pick<StaffProfileItem, 'permissions'>, permission: PermissionKey): boolean {
  return profile.permissions.includes(permission)
}

/** The catalog's entries grouped by area, in area order. */
export function groupByArea<T extends { area: PermissionArea }>(
  entries: readonly T[],
  areas: readonly PermissionArea[],
): { area: PermissionArea; entries: T[] }[] {
  return areas
    .map((area) => ({ area, entries: entries.filter((entry) => entry.area === area) }))
    .filter((group) => group.entries.length > 0)
}

/**
 * The board cargos administration deleted: the API lists only live cargos, and
 * the boot writes every board row, so a board cargo missing from the list is a
 * retired one. The team's selects stop offering it — the API refuses it anyway.
 */
export function retiredBoardRolesOf(profiles: readonly StaffProfileItem[]): BoardRole[] {
  const live = new Set(profiles.map((profile) => profile.role))
  return BOARD_ROLES.filter((role) => !live.has(role))
}

/** The cargos created in Equipo, as the team's selects offer them. */
export function customCargosOf(profiles: readonly StaffProfileItem[]): CustomCargo[] {
  return profiles.flatMap((profile) => (profile.role === null && profile.name ? [{ id: profile.id, name: profile.name }] : []))
}
