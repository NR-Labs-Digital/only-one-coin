import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listPaymentReviewQueue, parseReviewQueueQuery } from '@/lib/backoffice/payments'
import { reviewQueueSearchParams } from '@/lib/backoffice/payment-ledger-query'
import { redirect } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { getPlatformSettings } from '@/lib/backoffice/platform-settings'
import { canReviewPayments, canViewPayments } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ReviewQueueView } from './review-queue-view'

/**
 * The human review queue in full — what the home card previews. Every payment
 * still owed a decision ends here: the open enrollment is finished by approving
 * it, and its seat goes back to the class group by rejecting it.
 *
 * Search and paging live in the URL and run in Postgres
 * (`GET /api/v1/payments/review`, oldest first): this server component reads
 * them from `searchParams` and fetches exactly the page asked for. The client
 * component only rewrites the URL and sends the decisions.
 *
 * `?receipt=` names one of them. It is how the other screens hand a specific
 * case over — the ledger's payment dialog — instead of leaving the reader to
 * find in the queue the row they were already looking at. The ledger sends it
 * with a `q` that narrows the queue to that payment (`reviewCaseSearchParams`),
 * so the case is on the loaded page however deep in the queue it sits. An id
 * that is not on the loaded page just opens the queue: a stale link is not an
 * error page.
 */
export default async function PaymentsReviewPage({
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

  const raw = await searchParams
  const query = parseReviewQueueQuery(raw)
  const receipt = Array.isArray(raw.receipt) ? raw.receipt[0] : raw.receipt
  const [queue, settings] = await Promise.all([listPaymentReviewQueue(query), getPlatformSettings()])

  /* A failure is shown as a failure: an empty queue would read as "nobody is
     waiting", which is exactly what a reviewer must never be told by accident. */
  if (!queue) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('review.title')} />
        {tabs}
        <EmptyState
          icon="alert"
          title={t('review.load_error_title')}
          body={t('review.load_error_body')}
        />
      </div>
    )
  }

  /* Past the last page — the reader settled the only row on it, or followed an
     old link. The queue is not empty, so the page must not say it is: go to
     the last page that still has rows, keeping the search. */
  const lastPage = Math.max(1, Math.ceil(queue.total / queue.pageSize))
  // `lastPage < query.page` also keeps an inconsistent answer from looping.
  if (queue.items.length === 0 && queue.total > 0 && lastPage < query.page) {
    const search = reviewQueueSearchParams({ ...query, page: lastPage }).toString()
    redirect({
      href: search ? `/backoffice/payments/review?${search}` : '/backoffice/payments/review',
      locale,
    })
  }

  // The deadline colour is decided against the moment the page was rendered,
  // on the server: a clock read during the client render would disagree with
  // the server's HTML and break hydration.
  const renderedAt = Date.now()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('review.title')} />
      {tabs}
      <ReviewQueueView
        items={queue.items}
        total={queue.total}
        pageSize={queue.pageSize}
        query={query}
        canReview={canReviewPayments(staff.role)}
        openReceiptId={receipt ?? null}
        renderedAt={renderedAt}
        // Settings that could not be read only lose the low-confidence flag;
        // the queue itself still works.
        lowConfidencePercent={settings?.ocrLowConfidencePercent ?? null}
      />
    </div>
  )
}
