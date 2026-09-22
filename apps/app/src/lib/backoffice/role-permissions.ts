import type { StaffRole } from './types'
import {
  ALWAYS_ALLOWED_ROLES,
  CAPABILITIES,
  CAPABILITY_KEYS,
  CONFIGURABLE_ROLES,
  dependentsOf,
  type CapabilityKey,
} from './capabilities'

/**
 * Who holds each capability, and the one place that answers it.
 *
 * The catalog (`capabilities.ts`) says which doors exist and who opens them
 * when nobody has decided otherwise; this module holds what somebody decided
 * on `/backoffice/team/permissions` and resolves the two into a yes or a no.
 * Every `canX()` in `permissions.ts` is a call into here, so a cargo widened
 * on that screen widens the sidebar, the page gates and the buttons at once.
 *
 * ⚠️ The store below is provisional and lives in this process's memory: a
 * change holds for this deploy and is lost on the next restart, and two
 * instances of the app do not see each other's. It is the mock stage the rest
 * of the panel is in (`mock-data.ts`), not the finished thing. What it is
 * waiting on, on the backend side, is small and already shaped like
 * Funcionalidades:
 *
 *   - a `role_permission_overrides` table (capability, role, allowed,
 *     updated_by, updated_at) — additive migration, same shape as
 *     `feature_flag_overrides`;
 *   - `GET /api/v1/role-permissions` (panel cargos) and
 *     `PUT /api/v1/role-permissions/:capability`, declaring `admin`/`master`
 *     on the route like every other write (CLAUDE.md §8), writing the change
 *     to `audit_log`;
 *   - the API reading the same resolution when it authorizes a request —
 *     otherwise the panel would draw a door that the route still refuses,
 *     which is the safe failure but not the point of the screen.
 *
 * When those exist, only this file changes: `resolveRoles` reads the rows and
 * the two writers below become the `PUT`.
 */

/**
 * The configured role set per capability — the whole list, not a diff, so a
 * capability nobody has touched is simply absent and keeps following the
 * catalog even if the default changes in a later commit.
 *
 * Hung off `globalThis` rather than held as a plain module constant, for the
 * same reason a database client is: a server action and the render that
 * follows it do not always get the same instance of a module, so a Map
 * declared here would take the write on one copy and answer the next question
 * from another — the switch would flip and come back. One global, one store.
 */
const store = globalThis as typeof globalThis & {
  __oocRolePermissions?: Map<CapabilityKey, ReadonlySet<StaffRole>>
}

const overrides = (store.__oocRolePermissions ??= new Map<
  CapabilityKey,
  ReadonlySet<StaffRole>
>())

function isConfigurable(key: CapabilityKey, role: StaffRole): boolean {
  return !CAPABILITIES[key].locked && CONFIGURABLE_ROLES.includes(role)
}

/** Who holds `key` right now — the override if there is one, the default if not. */
function resolveRoles(key: CapabilityKey): ReadonlySet<StaffRole> {
  const configured = overrides.get(key)
  const roles = new Set<StaffRole>(configured ?? CAPABILITIES[key].defaultRoles)

  /* Management is not negotiable, whatever a stored row says — see
     ALWAYS_ALLOWED_ROLES. Applied on read rather than trusted on write: a row
     that arrives from somewhere else (the API, tomorrow) gets the same floor. */
  for (const role of ALWAYS_ALLOWED_ROLES) roles.add(role)

  return roles
}

/** The single question every gate in `permissions.ts` asks. */
export function isRoleAllowed(role: StaffRole, key: CapabilityKey): boolean {
  return resolveRoles(key).has(role)
}

export interface CapabilityRow {
  key: CapabilityKey
  group: (typeof CAPABILITIES)[CapabilityKey]['group']
  requires: CapabilityKey | null
  locked: boolean
  /** Who holds it now. */
  roles: StaffRole[]
  /** Whether somebody moved it away from what the catalog declares. */
  custom: boolean
}

/**
 * Whether a capability ends up somewhere other than where the catalog put it.
 *
 * Compared cargo by cargo rather than by asking whether a row was ever
 * written: giving `sales` something and taking it back leaves a row behind,
 * and calling that "off the default" would have the panel reporting a change
 * that is not there.
 */
function isCustom(key: CapabilityKey): boolean {
  if (!overrides.has(key)) return false

  const now = resolveRoles(key)
  const before = new Set<StaffRole>(CAPABILITIES[key].defaultRoles)
  for (const role of ALWAYS_ALLOWED_ROLES) before.add(role)

  if (now.size !== before.size) return true
  for (const role of before) if (!now.has(role)) return true
  return false
}

/** The matrix as the screen draws it. */
export function listCapabilities(): CapabilityRow[] {
  return CAPABILITY_KEYS.map((key) => {
    const spec = CAPABILITIES[key]
    const roles = resolveRoles(key)

    return {
      key,
      group: spec.group,
      requires: spec.requires ?? null,
      locked: spec.locked === true,
      roles: [...roles],
      custom: isCustom(key),
    }
  })
}

/**
 * Give or take one capability from one cargo, carrying the dependencies with
 * it: granting something that requires another grants that one too, and
 * revoking a requirement revokes whatever hangs off it. Half a door — a cargo
 * allowed to register a student but not to open the directory — is a bug
 * report waiting to be filed, so the screen never lets one be built.
 *
 * Returns every capability the call actually moved, so the screen can say what
 * else went with the click instead of the reader discovering it later.
 */
export function setCapabilityRole(
  key: CapabilityKey,
  role: StaffRole,
  allowed: boolean,
): CapabilityKey[] {
  if (!isConfigurable(key, role)) return []
  if (isRoleAllowed(role, key) === allowed) return []

  const moved: CapabilityKey[] = []

  const write = (target: CapabilityKey, value: boolean) => {
    if (!isConfigurable(target, role)) return
    if (isRoleAllowed(role, target) === value) return

    const roles = new Set(resolveRoles(target))
    if (value) roles.add(role)
    else roles.delete(role)

    overrides.set(target, roles)
    moved.push(target)
  }

  write(key, allowed)

  if (allowed) {
    /* Walk up: a requirement can itself require something. */
    let requirement = CAPABILITIES[key].requires
    while (requirement) {
      write(requirement, true)
      requirement = CAPABILITIES[requirement].requires
    }
  } else {
    /* Walk down: everything that hangs off what was just taken away. */
    const pending = dependentsOf(key)
    while (pending.length > 0) {
      const dependent = pending.shift()!
      write(dependent, false)
      pending.push(...dependentsOf(dependent))
    }
  }

  return moved
}

/**
 * Drop every decision this screen ever wrote. Clears the rows themselves, not
 * only the ones that still differ: a row that was moved and moved back is
 * invisible on the screen but still a stored decision, and "back to defaults"
 * should leave nothing behind.
 */
export function resetAllCapabilities(): void {
  overrides.clear()
}
