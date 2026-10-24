import type { FlagOverride } from './env'
import type { FlagOverrides } from './overrides'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
  type FeatureSurface,
} from './registry'

/**
 * How a flag is resolved, with nothing from Next in it: the request-bound
 * reads (cookie, session, the switchboard) live in `server.ts` and are handed
 * in here, so the ladder can be tested without a request.
 */

export type FeatureFlagState = Readonly<Record<FeatureFlagKey, boolean>>

/**
 * The two ways *we* see what is off for everybody else.
 *
 * - `preview` — the internal-unlock cookie (`preview.ts`). Every flag, every
 *   surface: it is the only way into the student portal, where nobody of ours
 *   has a session.
 * - `owner` — a staff session on an owners' e-mail domain (`isOwnerEmail`, the
 *   same rule that opens Funcionalidades). Staff surfaces only: the panel and
 *   the docente portal, where that session exists. The student portal runs on
 *   a student's session and keeps answering to the cookie alone.
 */
export type FlagUnlock = 'preview' | 'owner'

/** The surfaces a staff session browses — the ones the owner unlock covers. */
const STAFF_SURFACES: ReadonlySet<FeatureSurface> = new Set(['backoffice', 'teacher'])

export function isStaffSurface(surface: FeatureSurface): boolean {
  return STAFF_SURFACES.has(surface)
}

export function surfaceOf(key: FeatureFlagKey): FeatureSurface {
  return FEATURE_FLAGS[key].surface
}

/** Whether this unlock turns this flag on. */
export function unlocks(unlock: FlagUnlock | null, key: FeatureFlagKey): boolean {
  if (unlock === 'preview') return true
  if (unlock === 'owner') return isStaffSurface(surfaceOf(key))
  return false
}

/**
 * Which unlock this request carries, for a screen of `surface`.
 *
 * The cookie wins when both are there — it unlocks more. The session is read
 * only for a staff surface, so a portal page never pays a `/me` round trip,
 * and a reader that fails or finds nobody is "not an owner", never an error:
 * the resolver runs on pages with no session at all (the invite, the docente
 * login) and must not take them down (`apps/app/CLAUDE.md`, 09/09/2026).
 */
export async function resolveUnlock({
  surface,
  preview,
  readViewerEmail,
  isOwnerEmail,
}: {
  surface: FeatureSurface
  preview: boolean
  readViewerEmail: () => Promise<string | null>
  isOwnerEmail: (email: string) => boolean
}): Promise<FlagUnlock | null> {
  if (preview) return 'preview'
  if (!isStaffSurface(surface)) return null

  let email: string | null
  try {
    email = await readViewerEmail()
  } catch (error) {
    console.warn('[feature-flags] could not read the session; resolving as anybody else.', error)
    return null
  }
  return email !== null && isOwnerEmail(email) ? 'owner' : null
}

export interface FlagInputs {
  /** What somebody turned in Funcionalidades. */
  overrides: FlagOverrides
  /** `OOC_FLAG_<KEY>`, the deploy's own override. */
  envOverride: (key: FeatureFlagKey) => FlagOverride
  /** Which deploy this is (`env.ts`). */
  appEnv: string
}

function parentOf(key: FeatureFlagKey): FeatureFlagKey | undefined {
  // The registry is `as const`, so only the flags that declare a parent carry
  // the field; this reads it uniformly. The boot check proves the name is real.
  const spec: { surface: string; production: boolean; parent?: string } =
    FEATURE_FLAGS[key]
  return spec.parent as FeatureFlagKey | undefined
}

/**
 * The flag's own answer, before its parent has a say. Four sources, strongest
 * first — and the order is the whole design (CLAUDE.md §5):
 *
 * 1. `OOC_FLAG_*`, the deploy's own env var. It outranks the panel on purpose:
 *    it is the way back when the panel itself is what broke.
 * 2. The switchboard — what somebody turned in Funcionalidades. Scoped to this
 *    environment by nothing more than the database it was written in.
 * 3. Outside production, on. Local and preview are ours, and a branch is never
 *    demoed with half a panel missing.
 * 4. What the registry declares.
 *
 * Note that (2) beats (3): a person clicking a switch in *this* environment is
 * not the forgotten registry default the "everything on outside production"
 * rule was written to protect against — it is a deliberate act, and testing
 * the off state locally is exactly what somebody would open that screen for.
 */
function resolveOwn(key: FeatureFlagKey, inputs: FlagInputs): boolean {
  const envOverride = inputs.envOverride(key)
  if (envOverride) return envOverride === 'on'

  const panelOverride = inputs.overrides[key]
  if (panelOverride !== undefined) return panelOverride

  if (inputs.appEnv !== 'production') return true
  return FEATURE_FLAGS[key].production
}

function resolveForEverybody(key: FeatureFlagKey, inputs: FlagInputs): boolean {
  let current: FeatureFlagKey | undefined = key
  // The chain is three deep at most and the boot check proves every parent
  // exists; the guard is against a cycle someone introduces later.
  const seen = new Set<FeatureFlagKey>()
  while (current) {
    if (seen.has(current)) {
      throw new Error(`Feature flag cycle through "${current}".`)
    }
    seen.add(current)
    if (!resolveOwn(current, inputs)) return false
    current = parentOf(current)
  }
  return true
}

export interface FeatureFlagView {
  /** What this request sees. */
  flags: FeatureFlagState
  /** What everybody without an unlock sees — the state Funcionalidades reports. */
  everybody: FeatureFlagState
  /** The unlock this request carries, if any. */
  unlock: FlagUnlock | null
}

/**
 * Every flag, twice: as everybody sees it, and as this request does. An
 * unlocked flag is on whatever its parent says — an owner who turns
 * `backoffice` off must not lock themselves out of the panel with it, and
 * every parent of a staff flag is itself a staff flag.
 */
export function resolveFlags(inputs: FlagInputs, unlock: FlagUnlock | null): FeatureFlagView {
  const everybody = {} as Record<FeatureFlagKey, boolean>
  const flags = {} as Record<FeatureFlagKey, boolean>
  for (const key of FEATURE_FLAG_KEYS) {
    everybody[key] = resolveForEverybody(key, inputs)
    flags[key] = unlocks(unlock, key) || everybody[key]
  }
  return { flags, everybody, unlock }
}

/**
 * Whether this request sees the flag only because of its unlock. What the
 * banner and the "off for everybody else" mark in the menus are drawn from —
 * an unreleased screen nobody knows is unreleased is how "the student can't
 * find it" starts.
 */
export function isHiddenFromEverybody(view: FeatureFlagView, key: FeatureFlagKey): boolean {
  return view.flags[key] && !view.everybody[key]
}

/** Whether anything on this surface is on for this request and off for the rest. */
export function surfaceHasHiddenFlags(view: FeatureFlagView, surface: FeatureSurface): boolean {
  return FEATURE_FLAG_KEYS.some(
    (key) => surfaceOf(key) === surface && isHiddenFromEverybody(view, key),
  )
}
