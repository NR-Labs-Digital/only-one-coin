import type { ReactNode } from 'react'
import { getStaffSession } from '@/lib/backoffice/session'
import { isRestrictedToOwnClassGroups } from '@/lib/backoffice/permissions'
import { requireFeature } from '@/lib/feature-flags/server'

/**
 * The gate every screen of the panel answers to, except one: `../features`
 * sits outside this group on purpose. Funcionalidades carries no flag of its
 * own (`lib/feature-flags/registry.ts`) and it must not inherit `backoffice`'s
 * either — a surface's own flag is the one switch that takes a whole card
 * down, and if the switchboard died with it, turning `backoffice` off in
 * production would leave nobody able to turn it back on from here. The env
 * var would still work, but that is the break-glass path, not the front door.
 *
 * `../layout.tsx` still builds the shell (sidebar, header) for every screen
 * in the panel, features included — this layout only decides whether the
 * content under it exists at all.
 */
export default async function BackofficeGatedLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireFeature('backoffice')

  const staff = await getStaffSession()

  /* The docente panel is a surface of its own — the same app with the rail
     narrowed — and it can be off while the rest of the backoffice is on. A
     teacher then meets a 404 like anyone reaching a section that does not
     exist yet; every other cargo is untouched. */
  if (isRestrictedToOwnClassGroups(staff.role)) await requireFeature('teacher')

  return <>{children}</>
}
