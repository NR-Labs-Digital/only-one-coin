import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/feature-flags/server'

/**
 * Section gate. With `backoffice.complaints` off the whole section answers
 * 404 — the inbox and every sheet (CLAUDE.md §5).
 */
export default async function BoComplaintsLayout({ children }: { children: ReactNode }) {
  await requireFeature('backoffice.complaints')
  return <>{children}</>
}
