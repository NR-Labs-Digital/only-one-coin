import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseReports } from '@/lib/backoffice/permissions'
import { parseReportQuery } from '@/lib/backoffice/reports'
import { getReport } from '@/lib/backoffice/reports-server'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { ReportsView } from './reports-view'

/**
 * Reportes — the enrollment ledger and the seat map read from above:
 * enrollments, money and occupancy by course, language or teacher, per period.
 *
 * Read-only by design. Nothing is decided here — a payment is settled in Pagos,
 * a seat is moved in Matrículas — and a screen that only reports cannot be the
 * place a number gets changed.
 *
 * The figures come from `GET /api/v1/reports` (OOC-40), built every night by
 * the API: the period and the cut live in the URL, so each change is one read
 * of an aggregation that is already done, never a sum over the ledger.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* The screen says so; the role declared on the route in `apps/api` is what
     enforces it (CLAUDE.md §8). */
  if (!canBrowseReports(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('reports.title')} />
        <EmptyState icon="shield" title={t('reports.locked_title')} body={t('reports.locked_body')} />
      </div>
    )
  }

  const query = parseReportQuery(await searchParams)
  const report = await getReport(query)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('reports.title')} />
      {report === null ? (
        <EmptyState icon="reports" title={t('reports.load_error_title')} body={t('reports.load_error_body')} />
      ) : report.refreshedAt === null ? (
        <EmptyState icon="clock" title={t('reports.not_built_title')} body={t('reports.not_built_body')} />
      ) : (
        <ReportsView report={report} />
      )}
    </div>
  )
}
