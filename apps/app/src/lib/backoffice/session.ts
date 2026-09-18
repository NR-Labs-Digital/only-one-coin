import { cache } from 'react'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { apiFetch } from './api-client'
import type { StaffUser } from './types'

/**
 * Mock bridge, front phase only: `/me` always answers `teacherId: null`
 * because the `teachers` table does not exist yet (the route says so,
 * `apps/api/src/http/identity/GetCurrentStaffRoute.ts`), and a null
 * `teacherId` scopes a teacher session down to nothing — every docente screen
 * would demo as an empty state. So a `teacher` session with no record behind
 * it is pinned to this mock roster row, the same way every other screen reads
 * invented rows. Dies with the mock layer: once the table exists, `/me`
 * carries the real link and this constant goes with it.
 */
const DEMO_TEACHER_ID = 'tea_01'

/**
 * The signed-in staff member, read from the real session — never a client
 * choice (CLAUDE.md §8).
 *
 * No session, or a session `apps/api` rejects (expired, wrong role — a
 * `student`/`guardian` account has no business here): redirected to the
 * backoffice login rather than returned as null, so every call site below
 * can keep assuming a `StaffUser` exists, same as when this read a mock.
 *
 * Memoized per request (`cache`, same pattern as the feature-flag reads in
 * `lib/feature-flags/server.ts`): the panel's shell and its gate both need
 * it, on every screen, and that is one call to `/me` either way.
 */
export const getStaffSession = cache(async (): Promise<StaffUser> => {
  const response = await apiFetch('/api/v1/me')

  if (!response.ok) {
    const locale = await getLocale()
    redirect({ href: '/backoffice', locale })
    // redirect() throws NEXT_REDIRECT — unreachable, closes TS control flow.
    throw new Error('unreachable')
  }

  const staff = (await response.json()) as StaffUser
  if (staff.role === 'teacher' && staff.teacherId === null) {
    return { ...staff, teacherId: DEMO_TEACHER_ID }
  }
  return staff
})
