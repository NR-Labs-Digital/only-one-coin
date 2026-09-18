import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  getEnrollmentMetrics,
  listEnrollments,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateEnrollment,
  canBrowseEnrollments,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { EnrollmentsView } from './enrollments-view'

/**
 * Matrículas — every seat in the institution, in one list. Until now an
 * enrollment could only be read from inside the student it belongs to, which
 * answers "what did this person buy" and never "who is sitting in Inglés A1
 * this ciclo".
 *
 * Two screens: the ledger, and the seats still held by an unsettled payment.
 * The second is a screen and not a filter because it is a deadline — the cron
 * hands those seats back after the reservation window (CLAUDE.md §5), and
 * nobody chases a deadline they have to remember to filter for.
 *
 * The list is a client component so search, filters and paging work with no
 * backend; the data and the role gate come from the server. Hiding the create
 * button is a screen convenience — the enforcing check is the role declared on
 * the route in `apps/api` (CLAUDE.md §8).
 */
export default async function EnrollmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* Enrollments belong to administration and coordination
     (`docs/ARCHITECTURE.md` §3). Tesorería settles the money in the payments
     section and a teacher reaches their students through the class group —
     neither reads a roster of the whole institution. The screen says so; the
     role on the route in `apps/api` is what enforces it (CLAUDE.md §8). */
  if (!canBrowseEnrollments(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t('enrollments.title')}
        />
        <EmptyState
          icon="shield"
          title={t('enrollments.locked_title')}
          body={t('enrollments.locked_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('enrollments.title')}
      />
      <SectionTabs
        tabs={[
          {
            href: '/backoffice/enrollments',
            label: t('enrollments.tab_ledger'),
            exact: true,
          },
          {
            href: '/backoffice/enrollments/reservations',
            label: t('enrollments.tab_reservations'),
          },
        ]}
      />
      <EnrollmentsView
        rows={listEnrollments()}
        metrics={getEnrollmentMetrics()}
        canCreate={canCreateEnrollment(staff.role)}
      />
    </div>
  )
}
