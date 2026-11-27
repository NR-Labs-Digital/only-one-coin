import {
  BOARD_ROLES,
  type BoardRole,
  type PermissionAccess,
  type PermissionArea,
  type PermissionKey,
} from '@ooc/domain/permission-catalog'
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

/** How much of an area's "see" or "change" side a cargo holds. */
export type AccessLevel = 'all' | 'some' | 'none'

/**
 * The area's permissions of one side (OOC-192), read against what the cargo
 * holds; null when the area has none of that side (every account's own
 * settings are only "change").
 */
export function accessLevel<T extends { key: string; access: PermissionAccess }>(
  entries: readonly T[],
  held: ReadonlySet<string>,
  access: PermissionAccess,
): AccessLevel | null {
  const side = entries.filter((entry) => entry.access === access)
  if (side.length === 0) return null
  const count = side.filter((entry) => held.has(entry.key)).length
  return count === 0 ? 'none' : count === side.length ? 'all' : 'some'
}

/**
 * The area's "see" or "change" switch flipped (OOC-192). Changing needs
 * seeing, so turning "change" on turns "see" on too, and turning "see" off
 * turns "change" off. Only what `canFlip` allows moves — a permission the
 * viewer's own cargo lacks, or one no cargo hands out, stays as it was.
 */
export function withAreaAccess<T extends { key: string; access: PermissionAccess }>(
  held: ReadonlySet<string>,
  entries: readonly T[],
  access: PermissionAccess,
  on: boolean,
  canFlip: (entry: T) => boolean,
): Set<string> {
  const next = new Set(held)
  const touched = entries.filter((entry) =>
    on ? entry.access === 'view' || access === 'edit' : entry.access === 'edit' || access === 'view',
  )
  for (const entry of touched) {
    if (!canFlip(entry)) continue
    if (on) next.add(entry.key)
    else next.delete(entry.key)
  }
  return next
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
