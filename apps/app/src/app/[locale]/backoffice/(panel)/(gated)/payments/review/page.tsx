import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  listReceiptExtractions,
  listReviewQueue,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canReviewPayments, canViewPayments } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ReviewQueueView } from './review-queue-view'

/**
 * The human review queue in full — what the home card previews. Everything the
 * OCR ladder could not settle on its own ends here (CLAUDE.md §5): a mismatch
 * against the frozen plan price, low confidence on a critical field, an
 * illegible image, a repeated receipt, or two model families disagreeing.
 *
 * The list is a client component so search, filters and paging work with no
 * backend; the data and the role gate come from the server. Each row carries
 * its extraction, so opening one shows the image next to what the model read
 * without a second round trip.
 *
 * `?receipt=` names one of them. It is how the other screens hand a specific
 * case over — a held seat, a payment line — instead of leaving the reader to
 * find in the queue the row they were already looking at. An id that matches
 * nothing just opens the queue: a stale link is not an error page.
 */
export default async function PaymentsReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ receipt?: string }>
}) {
  const { locale } = await params
  const { receipt } = await searchParams
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
      <PageHeader title={t('review.title')} />
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
      <ReviewQueueView
        rows={listReviewQueue()}
        extractions={listReceiptExtractions()}
        canReview={canReviewPayments(staff.role)}
        openReceiptId={receipt ?? null}
      />
    </div>
  )
}
