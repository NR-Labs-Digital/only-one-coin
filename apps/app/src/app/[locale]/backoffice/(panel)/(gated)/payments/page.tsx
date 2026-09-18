import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  getPaymentMetrics,
  listPayments,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canViewPayments } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { PaymentsView } from './payments-view'

/**
 * Payments, the whole ledger. One section, three screens: what came in, what
 * is still waiting on a human, and the parameters that decide which is which.
 *
 * The list is a client component so search, filters and paging work with no
 * backend; the data and the role gates come from the server. Hiding a tab or a
 * button is a screen convenience — the enforcing check is the role declared on
 * the route in `apps/api` (CLAUDE.md §8).
 */
export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  if (!canViewPayments(staff.role)) {
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('payments.title')} />
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
      <PaymentsView rows={listPayments()} metrics={getPaymentMetrics()} />
    </div>
  )
}
