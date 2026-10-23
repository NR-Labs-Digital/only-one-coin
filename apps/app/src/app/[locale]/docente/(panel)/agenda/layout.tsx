import type { ReactNode } from 'react'
import { requireFeature } from '@/lib/feature-flags/server'

/** Section gate: with `teacher.agenda` off the agenda answers 404 (CLAUDE.md §5). */
export default async function TeacherAgendaLayout({ children }: { children: ReactNode }) {
  await requireFeature('teacher.agenda')
  return <>{children}</>
}
