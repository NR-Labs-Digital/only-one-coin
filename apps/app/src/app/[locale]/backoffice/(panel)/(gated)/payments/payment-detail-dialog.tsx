'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { PaymentRow } from '@/lib/backoffice/types'
import { reviewCaseSearchParams } from '@/lib/backoffice/payment-ledger-query'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { paymentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * One payment, opened from the ledger as a modal: the data behind the row.
 * Read-only on purpose — a payment changes state in the review queue, next to
 * the receipt image, because approving is a usecase with its own audit entry
 * and not a click on a list (CLAUDE.md §8).
 *
 * It exists so the row can stay a row. Rail, operation number and who settled
 * it are all worth one look each and none of them worth a column: in the table
 * they turned every line into four stacked lines.
 *
 * An open payment carries the way to where it is decided, for whoever decides
 * it (`canReview`). The link is a convenience; the role on the settle route in
 * `apps/api` is what enforces it (CLAUDE.md §8).
 */
export function PaymentDetailDialog({
  payment,
  canReview,
  onClose,
}: {
  payment: PaymentRow | null
  canReview: boolean
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const mismatch =
    payment !== null && payment.amountCents !== payment.expectedAmountCents
  const undecided =
    payment !== null &&
    (payment.status === 'pending' || payment.status === 'under_review')

  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        closeLabel={t('payments.detail_close')}
        className="bg-white"
      >
        {payment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {payment.studentName}
              </DialogTitle>
              <DialogDescription>
                {t('receipt_review.subtitle', {
                  date: formatDateTime(payment.submittedAt, locale),
                  course: payment.courseName,
                })}
              </DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={paymentTone[payment.status]}
                  label={t(`payment_status.${payment.status}`)}
                />
                <StatusBadge
                  tone={payment.procedureKind ? 'info' : 'neutral'}
                  label={t(`payment_origin.${payment.procedureKind ?? 'enrollment'}`)}
                />
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-6 p-5">
              <section>
                <SectionTitle icon="doc">
                  {t('receipt_review.image_title')}
                </SectionTitle>
                {/* The ledger never asks for the image: every signed URL is an
                    audited read (CLAUDE.md §8), and the queue is where a
                    receipt is looked at — next to the decision it serves. */}
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                  <BoIcon name="doc" size={14} className="mt-0.5 shrink-0 text-brand-blue" />
                  {t('payments.detail_receipt_note')}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('receipt_review.image_note')}
                </p>
              </section>

              <section>
                <SectionTitle icon="payments">
                  {t('payments.detail_data_title')}
                </SectionTitle>
                <dl className="mt-2">
                  <DataRow
                    label={t('payments.filter_method')}
                    value={formatPaymentMethod(
                      payment.method,
                      payment.methodDetail,
                      t('payment_method.other'),
                    )}
                  />
                  <DataRow
                    label={t('payments.col_operation')}
                    value={payment.operationNumber ?? t('payments.no_operation')}
                  />
                  <DataRow
                    label={t('payments.detail_amount')}
                    value={formatMoney(
                      payment.amountCents,
                      payment.currency,
                      locale,
                    )}
                    tone={mismatch ? 'danger' : 'default'}
                  />
                  <DataRow
                    label={t('receipt_review.check_expected')}
                    value={formatMoney(
                      payment.expectedAmountCents,
                      payment.currency,
                      locale,
                    )}
                  />
                  <DataRow
                    label={t('payments.col_submitted')}
                    value={formatDateTime(payment.submittedAt, locale)}
                  />
                  {/* Who settled it, or that nobody has. A decision whose
                      audit entry names no account still happened — it reads
                      as an unknown author, not as a blank. */}
                  <DataRow
                    label={t('payments.col_decided')}
                    value={
                      payment.decidedAt
                        ? `${formatDateTime(payment.decidedAt, locale)} · ${
                            payment.decidedByName ?? t('payments.decided_by_unknown')
                          }`
                        : t('payments.decided_open')
                    }
                  />
                </dl>
                {/* The difference is the whole reason the case is open, so it
                    is a line of its own and not a subtraction left to the
                    reader. */}
                {mismatch && (
                  <p className="mt-2 text-xs font-semibold text-red-600">
                    {t('receipt_review.check_difference', {
                      amount: formatMoney(
                        Math.abs(
                          payment.amountCents - payment.expectedAmountCents,
                        ),
                        payment.currency,
                        locale,
                      ),
                    })}
                  </p>
                )}
              </section>
            </div>

            {/* Still owed a decision: the way to where it is taken, next to
                the receipt image. The link searches the queue down to this
                payment, so it opens the case wherever the queue had it.
                Full width, so on a phone it is the one action under the data. */}
            {undecided && canReview && (
              <DialogFooter className="border-t border-line p-5">
                <Link
                  href={`/backoffice/payments/review?${reviewCaseSearchParams(payment).toString()}`}
                  className="inline-flex min-h-tap w-full items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                >
                  {t('payments.open_review')}
                  <BoIcon name="chevron-right" size={16} />
                </Link>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DataRow({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`text-right text-sm font-medium tabular-nums ${
          tone === 'danger' ? 'text-red-600' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
