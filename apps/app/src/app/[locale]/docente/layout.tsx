import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/feature-flags/server'

/**
 * The docente portal as a whole — login included — answers to the `teacher`
 * flag: off, `/docente` is a 404 like any section that does not exist
 * (`apps/app/CLAUDE.md`, feature flags). Never indexed, never linked from the
 * landing — same discretion as the backoffice (CLAUDE.md §8).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function TeacherPortalLayout({ children }: { children: ReactNode }) {
  await requireFeature('teacher')
  return <>{children}</>
}
