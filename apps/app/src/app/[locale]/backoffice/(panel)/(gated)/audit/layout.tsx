import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/feature-flags/server'

/**
 * Section gate. With `backoffice.audit` off the whole section answers 404 —
 * this screen and anything added here tomorrow (CLAUDE.md §5).
 */
export default async function BoAuditLayout({ children }: { children: ReactNode }) {
  await requireFeature('backoffice.audit')
  return <>{children}</>
}
