import type { StaffRole } from './types'

/**
 * A cargo administration created in Equipo (OOC-183). Its accounts carry the
 * `custom` role and point here; the name is what administration typed, so it
 * is shown as is — it is data, not a string of the interface.
 */
export interface CustomCargo {
  id: string
  name: string
}

/** A cargo as a select's value: a board role, or `custom:<id>`. */
export type CargoValue = string

export function cargoValue(role: StaffRole, profileId: string | null): CargoValue {
  return role === 'custom' && profileId ? `custom:${profileId}` : role
}

export function parseCargoValue(value: CargoValue): { role: StaffRole; profileId: string | null } {
  return value.startsWith('custom:')
    ? { role: 'custom', profileId: value.slice('custom:'.length) }
    : { role: value as StaffRole, profileId: null }
}

/**
 * What to call an account's cargo: the locale's name for a board cargo, the
 * typed name for one created in Equipo. `fallback` is the locale's generic
 * "custom cargo", for the moment a name is missing (a cargo retired since).
 */
export function cargoLabel(
  role: StaffRole,
  profileName: string | null,
  roleLabel: (role: StaffRole) => string,
): string {
  return role === 'custom' ? (profileName ?? roleLabel('custom')) : roleLabel(role)
}
