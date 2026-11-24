import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listPayments, parsePaymentLedgerQuery } from '@/lib/backoffice/payments'
import { getStaffSession } from '@/lib/backoffice/session'
import { canReviewPayments, canViewPayments } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { PaymentsView } from './payments-view'

/**
 * Payments, the whole ledger. One section, two screens: what came in, and what
 * is still waiting on a human.
 *
 * Search, filters and paging live in the URL and run in Postgres: this server
 * component reads them from `searchParams` and fetches exactly the page asked
 * for (`GET /api/v1/payments`). The client component only rewrites the URL.
 * Hiding a tab or a button is a screen convenience — the enforcing check is
 * the role declared on the route in `apps/api` (CLAUDE.md §8).
 */
export default async function PaymentsPage({
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

  if (!canViewPayments(staff)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('payments.title')} />
        {/* Money is not the teacher's half of the panel — they run a class
            group. The screen says so; the role on the route in `apps/api` is
            what enforces it (CLAUDE.md §8). */}
        <EmptyState
          icon="shield"
          title={t('payments.locked_title')}
          body={t('payments.locked_body')}
        />
      </div>
    )
  }

  const tabs = (
    <SectionTabs
      tabs={[
        {
          href: '/backoffice/payments',
          label: t('payments.tab_ledger'),
          exact: true,
        },
        { href: '/backoffice/payments/review', label: t('payments.tab_review') },
      ]}
    />
  )

  /* A failure is shown as a failure: an empty ledger would read as "nothing
     was collected this period", which is the one thing this screen must never
     say by accident. */
  const query = parsePaymentLedgerQuery(await searchParams)
  const ledger = await listPayments(query)

  if (!ledger) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('payments.title')} />
        {tabs}
        <EmptyState
          icon="alert"
          title={t('payments.load_error_title')}
          body={t('payments.load_error_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('payments.title')} />
      {tabs}
      <PaymentsView
        ledger={ledger}
        query={query}
        canReview={canReviewPayments(staff)}
      />
    </div>
  )
}
