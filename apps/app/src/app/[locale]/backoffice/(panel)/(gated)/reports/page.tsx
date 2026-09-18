import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  listClassGroupRosters,
  listClassGroups,
  listEnrollments,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseReports } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { ReportsView } from './reports-view'

/**
 * Reportes — the enrollment ledger and the seat map read from above:
 * enrollments, money and occupancy by course and by period, which is what the
 * module promised from the first sketch of the panel.
 *
 * Read-only by design. Nothing is decided here — a payment is settled in Pagos,
 * a seat is moved in Matrículas — and a screen that only reports cannot be the
 * place a number gets changed.
 *
 * The aggregation runs in the browser because the dataset is mocked; against
 * the real API it is a server query, since the ledger reaches 20k rows a month
 * in peak season (CLAUDE.md §1).
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* The report is the academic ledger summed up, so it belongs to the two
     roles that answer for it. The screen says so; the role declared on the
     route in `apps/api` is what enforces it (CLAUDE.md §8). */
  if (!canBrowseReports(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('reports.title')} />
        <EmptyState
          icon="shield"
          title={t('reports.locked_title')}
          body={t('reports.locked_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('reports.title')} />
      <ReportsView
        enrollments={listEnrollments()}
        classGroups={listClassGroups()}
        rosters={listClassGroupRosters()}
      />
    </div>
  )
}
