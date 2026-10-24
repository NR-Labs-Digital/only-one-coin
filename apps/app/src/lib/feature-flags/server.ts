import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { isOwnerEmail } from '@/lib/backoffice/permissions'
import { readStaffSession } from '@/lib/backoffice/session'
import { featureEnv, readFlagOverride } from './env'
import { getFlagOverrides } from './overrides'
import { PREVIEW_COOKIE, isPreviewTokenValid } from './preview'
import type { FeatureFlagKey, FeatureSurface } from './registry'
import {
  resolveFlags,
  resolveUnlock,
  surfaceOf,
  type FeatureFlagState,
  type FeatureFlagView,
} from './resolve'

/**
 * Reading a flag. Server side only, on purpose: a flag never reaches the
 * client bundle, so what is off in production is not a list a reader can pull
 * out of the JavaScript. Client components receive the resolved boolean as a
 * prop, never the registry.
 *
 * The ladder itself is `resolve.ts`; this file only gathers what it needs from
 * the request — the switchboard, the preview cookie and, on a staff surface,
 * who is browsing.
 */

export type { FeatureFlagState, FeatureFlagView }

/**
 * Every flag, resolved for this request, as seen from a screen of `surface`.
 * The surface is the screen's, not the flag's: it decides whether the session
 * is read at all (`resolveUnlock`) — a portal page never asks the API who is
 * browsing. Memoized per request and surface: the layout, the nav and each
 * gate below read the same answer.
 */
export const getFeatureView = cache(async (surface: FeatureSurface): Promise<FeatureFlagView> => {
  const [preview, overrides] = await Promise.all([isInternalPreview(), getFlagOverrides()])
  const unlock = await resolveUnlock({
    surface,
    preview,
    readViewerEmail: async () => (await readStaffSession())?.email ?? null,
    isOwnerEmail,
  })
  return resolveFlags(
    { overrides, envOverride: readFlagOverride, appEnv: featureEnv.APP_ENV },
    unlock,
  )
})

/** What a screen of `surface` shows — the unlock included. */
export async function getFeatureFlags(surface: FeatureSurface): Promise<FeatureFlagState> {
  return (await getFeatureView(surface)).flags
}

/**
 * Whether this browser carries the internal unlock. Everything a flag hides is
 * visible to it — that is the whole point of "desativado fica só pra nós".
 */
export const isInternalPreview = cache(async (): Promise<boolean> => {
  const jar = await cookies()
  return isPreviewTokenValid(jar.get(PREVIEW_COOKIE)?.value)
})

/** Read from the flag's own surface — it is the surface whose screens it gates. */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  return (await getFeatureFlags(surfaceOf(key)))[key]
}

/**
 * The gate. A disabled section is not a locked screen with an explanation —
 * it does not exist: `notFound()`, the same answer a typo in the URL gets, so
 * nothing on the air hints at what is being built (CLAUDE.md §8).
 *
 * Called from the `layout.tsx` of each section, never from a single page, so
 * a screen added to a gated section tomorrow inherits the gate instead of
 * needing to remember it.
 */
export async function requireFeature(key: FeatureFlagKey): Promise<void> {
  if (!(await isFeatureEnabled(key))) notFound()
}
