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
 * (`teachers.user_id`, OOC-79), or null when no file links to it — the API
 * then scopes every docente read down to nothing (`/teaching`, OOC-82).
 *
 * Memoized per request (`cache`, same pattern as the feature-flag reads in
 * `lib/feature-flags/server.ts`): the panel's shell and its gate both need
 * it, on every screen, and that is one call to `/me` either way.
 */
export const getStaffSession = cache(
  async (loginHref: '/backoffice' | '/docente' = '/backoffice'): Promise<StaffUser> => {
  const response = await apiFetch('/api/v1/me')

  if (!response.ok) {
    const locale = await getLocale()
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    // The second factor is enrolled on the backoffice login's own step
    // (OOC-29); every other refusal goes back to the door the reader came in by.
    const href =
      body?.reason === 'auth.mfa_enrollment_required' ? '/backoffice?mfa=setup' : loginHref
    redirect({ href, locale })
    // redirect() throws NEXT_REDIRECT — unreachable, closes TS control flow.
    throw new Error('unreachable')
  }

  return (await response.json()) as StaffUser
  },
)

/**
 * The signed-in staff member, for the backoffice shell — the backoffice's side
 * of the door. A teacher has nothing here: the docente portal is their door
 * (`/docente`, own login, own shell), and they are sent there, decided from
 * the role on the session, never from anything on the screen (CLAUDE.md §8).
 * That redirect is the only place the backoffice names the teacher cargo.
 */
export const getBackofficeSession = cache(async (): Promise<StaffUser> => {
  const staff = await getStaffSession()
  if (staff.role === 'teacher') {
    const locale = await getLocale()
    redirect({ href: '/docente/home', locale })
    throw new Error('unreachable')
  }
  return staff
})

/**
 * The signed-in teacher, for the docente portal (`/docente`). The portal is
 * its own door — own login, own shell — but the same auth and the same
 * `/me`: what makes it the teacher's is the role read from the session,
 * server-side, never a choice on the screen (CLAUDE.md §8). Anybody else who
 * lands here is sent to the backoffice, the way a teacher who lands on the
 * backoffice is sent here.
 *
 * Only the role decides which door — never whether the account has a teacher
 * file. A `teacher` account with no file linked (`teacherId: null`, opened
 * before OOC-79) stays here with an empty scope: sending it to the backoffice
 * would bounce it straight back, since the backoffice sends every teacher here.
 */
export const getTeacherSession = cache(
  async (): Promise<StaffUser & { role: 'teacher' }> => {
    const staff = await getStaffSession('/docente')
    if (staff.role !== 'teacher') {
      const locale = await getLocale()
      redirect({ href: '/backoffice/home', locale })
      throw new Error('unreachable')
    }
    return { ...staff, role: 'teacher' }
  },
)
