'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PaymentRow } from '@/lib/backoffice/types'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { paymentTone, reviewFlagTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * One payment, opened from the ledger as a modal: the receipt the student uploaded and the
 * data behind the row. Read-only on purpose — a payment changes state in the
 * review queue, next to what the model read, because approving is a usecase
 * with its own audit entry and not a click on a list (CLAUDE.md §8).
 *
 * It exists so the row can stay a row. Flag, rail, operation number and who
 * settled it are all worth one look each and none of them worth a column: in
 * the table they turned every line into four stacked lines.
 */
export function PaymentDetailDialog({
  payment,
  onClose,
}: {
  payment: PaymentRow | null
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const mismatch =
    payment !== null && payment.amountCents !== payment.expectedAmountCents

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
                  course:
                    payment.concept.kind === 'course'
                      ? payment.concept.courseName
                      : t(`document_type.${payment.concept.type}`),
                })}
              </DialogDescription>
              {/* The state and, when it is open, why it is open. This is the
                  pair the table used to stack on every row. */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={paymentTone[payment.status]}
                  label={t(`payment_status.${payment.status}`)}
                />
                {payment.flag && (
                  <StatusBadge
                    tone={reviewFlagTone[payment.flag]}
                    dot={false}
                    label={t(`review_flag.${payment.flag}`)}
                  />
                )}
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-6 p-5">
              <section>
                <SectionTitle icon="doc">
                  {t('receipt_review.image_title')}
                </SectionTitle>
                {/* No storage is wired yet; in production this is a signed URL
                    of 5 minutes, scoped to the student (CLAUDE.md §8). */}
                <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-sky-soft px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-brand-blue shadow-card">
                    <BoIcon name="doc" size={20} />
                  </span>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {t('receipt_review.image_placeholder')}
                  </p>
                </div>
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
                    value={
                      payment.method
                        ? formatPaymentMethod(
                            payment.method,
                            null,
                            t('payment_method.other'),
                          )
                        : t('payments.no_method')
                    }
                  />
                  <DataRow
                    label={t('payments.col_operation')}
                    value={payment.operationNumber ?? t('payments.no_operation')}
                  />
                  <DataRow
                    label={t('receipt_review.check_read')}
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
                  {/* Who settled it, or that nobody has. An approved payment
                      with no name behind it went through the ladder alone —
                      that is an answer, not a blank. */}
                  <DataRow
                    label={t('payments.col_decided')}
                    value={
                      payment.decidedAt
                        ? `${formatDateTime(payment.decidedAt, locale)} · ${
                            payment.decidedByName ?? t('payments.decided_auto')
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
