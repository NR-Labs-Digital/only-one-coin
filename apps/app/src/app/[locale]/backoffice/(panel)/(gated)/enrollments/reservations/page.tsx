import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  getPaymentSettings,
  listSeatReservations,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseEnrollments } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ReservationsView } from './reservations-view'

/**
 * The seats held by a payment nobody has settled. A reservation is not a state
 * to browse — it is a countdown: after the reservation window the cron hands
 * the seat back (CLAUDE.md §5), and whoever paid and got ignored loses the
 * place they already bought.
 *
 * Soonest to expire first, always. The window is read from the payment
 * settings, the same number the job runs on, so the screen can never promise a
 * day the release does not honour.
 *
 * The countdown is computed here, on the server clock, and handed down as a
 * number: computing it inside the component would hydrate a different figure
 * than it rendered.
 */
export default async function ReservationsPage({
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
        title={t('reservations.title')}
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
      <ReservationsView
        rows={listSeatReservations()}
        reservationDays={getPaymentSettings().reservationDays}
      />
    </div>
  )
}
