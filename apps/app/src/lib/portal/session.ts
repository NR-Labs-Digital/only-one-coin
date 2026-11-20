import { cache } from 'react'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { apiFetch } from '@/lib/backoffice/api-client'
import { nextClassOf, toEnrollment, toProcedure, toRequest, type OverviewResponse } from './overview'
import { withProfile } from './profile'
import type { PortalProfile, PortalSession } from './types'

export interface StudentIdentity {
  firstName: string
  lastName: string
  email: string
  /** The profile shown, and every profile of the account (OOC-147). */
  profileId: string
  profiles: PortalProfile[]
}

async function backToLogin(): Promise<never> {
  const locale = await getLocale()
  redirect({ href: '/login', locale })
  throw new Error('unreachable')
}

/**
 * The signed-in student, read from the real session (`GET /portal/me`) —
 * never a client choice (CLAUDE.md §8). No session, an expired one, a staff
 * session or an account with no file behind it: back to the login. Every page
 * under /portal calls this (memoized per request), not only the layout — a
 * layout is not re-run on client navigation, a page is.
 */
export const getStudentSession = cache(async (): Promise<StudentIdentity> => {
  const response = await apiFetch(await withProfile('/api/v1/portal/me'))
  if (!response.ok) return backToLogin()
  return (await response.json()) as StudentIdentity
})

/**
 * Everything the portal shows about the chosen profile (OOC-147), from
 * `GET /portal/overview` (OOC-32) —
 * memoized per request, so the layout and the page share one call. Same
 * guard as `getStudentSession`: any non-OK answer is back to the login.
 *
 * What has no backend yet arrives empty, never as sample data: continuation
 * offers — the screen already has an empty state. The one notice there is
 * comes from the data itself: a monthly module the student is on and has not
 * bought (OOC-86).
 * Issued documents (OOC-33) are not here: they will join the student's
 * document list (`GET /portal/attachments`, OOC-148).
 */
export const getPortalView = cache(async (): Promise<PortalSession> => {
  const response = await apiFetch(await withProfile('/api/v1/portal/overview'))
  if (!response.ok) return backToLogin()
  const overview = (await response.json()) as OverviewResponse

  const enrollments = overview.enrollments.map(toEnrollment)
  return {
    // An API from before OOC-147 sends neither: the app and the API do not
    // deploy at the same instant, and a portal that waits for the other half
    // must still render — one profile, no switcher.
    profileId: overview.profileId ?? '',
    profiles: overview.profiles ?? [],
    student: overview.student,
    passingGrade: overview.passingGrade,
    // An API from before OOC-72 says nothing: no gate, no notice.
    guardianConsent: overview.guardianConsent ?? { state: 'not_required', canAccept: false, version: '' },
    enrollments,
    requests: overview.requests.map(toRequest),
    procedures: overview.procedures.map(toProcedure),
    offers: [],
    notifications: enrollments
      .filter((enrollment) => enrollment.classAccessLock === 'monthly_payment_due')
      .map((enrollment) => ({
        id: `monthly_payment_due:${enrollment.id}`,
        kind: 'monthly_payment_due' as const,
        // The notice is about now: it holds while the lock does.
        createdAt: new Date().toISOString(),
        courseName: enrollment.course.name,
      })),
    nextClass: nextClassOf(enrollments, new Date()),
  }
})
