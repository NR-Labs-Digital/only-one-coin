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
 * What has no backend yet arrives empty, never as sample data: notices and
 * continuation offers — the screens already have an empty state for each.
 * Issued documents (OOC-33) are not here: they will join the student's
 * document list (`GET /portal/attachments`, OOC-148).
 */
export const getPortalView = cache(async (): Promise<PortalSession> => {
  const response = await apiFetch(await withProfile('/api/v1/portal/overview'))
  if (!response.ok) return backToLogin()
  const overview = (await response.json()) as OverviewResponse

  const enrollments = overview.enrollments.map(toEnrollment)
  return {
    profileId: overview.profileId,
    profiles: overview.profiles,
    student: overview.student,
    passingGrade: overview.passingGrade,
    enrollments,
    requests: overview.requests.map(toRequest),
    procedures: overview.procedures.map(toProcedure),
    offers: [],
    notifications: [],
    nextClass: nextClassOf(enrollments, new Date()),
  }
})
