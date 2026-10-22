import { cache } from 'react'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { apiFetch } from './api-client'
import type { StaffUser } from './types'

/**
 * The signed-in staff member, read from the real session — never a client
 * choice (CLAUDE.md §8).
 *
 * No session, or a session `apps/api` rejects (expired, wrong role — a
 * `student`/`guardian` account has no business here): redirected to the
 * backoffice login rather than returned as null, so every call site below
 * can keep assuming a `StaffUser` exists, same as when this read a mock.
 *
 * A cargo that must have the second factor and has not turned it on yet is
 * refused by apps/api on `/me` too (`auth.mfa_enrollment_required`, OOC-29):
 * that one goes to the login's enrollment step, not back to the password.
 *
 * A `teacher` account carries the id of the teacher file it is linked to
 * (`teachers.user_id`, OOC-79), or null when no file links to it — every
 * docente screen then scopes them down to nothing.
 *
 * Memoized per request (`cache`, same pattern as the feature-flag reads in
 * `lib/feature-flags/server.ts`): the panel's shell and its gate both need
 * it, on every screen, and that is one call to `/me` either way.
 */
export const getStaffSession = cache(async (): Promise<StaffUser> => {
  const response = await apiFetch('/api/v1/me')

  if (!response.ok) {
    const locale = await getLocale()
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    const href =
      body?.reason === 'auth.mfa_enrollment_required' ? '/backoffice?mfa=setup' : '/backoffice'
    redirect({ href, locale })
    // redirect() throws NEXT_REDIRECT — unreachable, closes TS control flow.
    throw new Error('unreachable')
  }

  return (await response.json()) as StaffUser
})
