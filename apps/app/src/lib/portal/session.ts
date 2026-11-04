import { cache } from 'react'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { apiFetch } from '@/lib/backoffice/api-client'
import { nextClassOf, toEnrollment, toProcedure, toRequest, type OverviewResponse } from './overview'
import type { PortalSession } from './types'

export interface StudentIdentity {
  firstName: string
  lastName: string
  email: string
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
  const response = await apiFetch('/api/v1/portal/me')
  if (!response.ok) return backToLogin()
  return (await response.json()) as StudentIdentity
})

/**
 * Everything the portal shows, from `GET /portal/overview` (OOC-32) —
 * memoized per request, so the layout and the page share one call. Same
 * guard as `getStudentSession`: any non-OK answer is back to the login.
 *
 * What has no backend yet arrives empty, never as sample data: documents
 * (OOC-33), notices and continuation offers. The screens already have an empty
 * state for each.
 */
export const getPortalView = cache(async (): Promise<PortalSession> => {
  const response = await apiFetch('/api/v1/portal/overview')
  if (!response.ok) return backToLogin()
  const overview = (await response.json()) as OverviewResponse

  const enrollments = overview.enrollments.map(toEnrollment)
  return {
    student: overview.student,
    enrollments,
    documents: [],
    requests: overview.requests.map(toRequest),
    procedures: overview.procedures.map(toProcedure),
    offers: [],
    notifications: [],
    nextClass: nextClassOf(enrollments, new Date()),
  }
})
