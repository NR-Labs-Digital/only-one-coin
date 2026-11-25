import type { GradeRegisterStatus } from '@/lib/docente/grade-register'
import type { Tone } from '@/components/backoffice/ui'

/**
 * The tone of each register state, shared by the teacher's portal and the
 * backoffice (OOC-180). A plain module, not the client summary's: a server
 * page cannot index a value exported from a `'use client'` file.
 */
export const registerTone: Record<GradeRegisterStatus, Tone> = {
  draft: 'neutral',
  in_review: 'warning',
  returned: 'danger',
  official: 'success',
}
