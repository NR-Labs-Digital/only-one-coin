'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StudentPaymentItem } from '@/lib/backoffice/types'
import { fetchReceiptUrl } from '@/lib/backoffice/payment-client'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { EmptyState, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { paymentTone, verdictTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ImageState =
  | { kind: 'loading' }
  | { kind: 'shown'; url: string }
  | { kind: 'unavailable' }

/**
 * The receipts block of the student file's Documents tab (OOC-62): every
 * payment the student sent a receipt for — enrollment, monthly module, paid
 * procedure, lot — in any state, newest first, so whoever answers the student
 * sees the whole money trail without leaving the file.
 *
 * Read-only: a payment is decided in Pagos, next to the image. The image here
 * is the same signed five-minute URL and the same audited read as there, asked
 * for only when someone clicks — never ahead of time for the list — and only
 * offered to a cargo the API lets open it (`canOpenImage`).
 */
export function StudentReceipts({
  payments,
  canOpenImage,
}: {
  /** null when the API failed — said as such, never as "no receipts". */
  payments: StudentPaymentItem[] | null
  canOpenImage: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [opened, setOpened] = useState<StudentPaymentItem | null>(null)
  const [image, setImage] = useState<ImageState>({ kind: 'loading' })

  const openedId = useRef<string | null>(null)

  function close() {
    openedId.current = null
    setOpened(null)
  }

  async function openImage(payment: StudentPaymentItem) {
    openedId.current = payment.id
    setOpened(payment)
    setImage({ kind: 'loading' })
    const result = await fetchReceiptUrl(payment.id)
    // A late answer for a receipt already closed or swapped is dropped.
    if (openedId.current !== payment.id) return
    setImage(result.ok ? { kind: 'shown', url: result.data.url } : { kind: 'unavailable' })
  }

  const columns = [
    t('student_receipts.col_submitted'),
    t('student_receipts.col_for'),
    t('student_receipts.col_amount'),
    t('student_receipts.col_verdict'),
    t('student_receipts.col_status'),
    '',
  ]

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">{t('student_receipts.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('student_receipts.subtitle')}</p>
      </div>

      {payments === null ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('student_receipts.load_error')}
        </p>
      ) : payments.length === 0 ? (
        <EmptyState icon="payments" title={t('student_receipts.empty_title')} body={t('student_receipts.empty_body')} />
      ) : (
        <TableShell columns={columns}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} className={thClass}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => {
              const mismatch = payment.amountCents !== payment.expectedAmountCents
              const readMismatch =
                payment.readAmountCents !== null && payment.readAmountCents !== payment.expectedAmountCents
              return (
                <tr key={payment.id}>
                  <td className={tdClass}>
                    <span className="tabular-nums">{formatDateTime(payment.submittedAt, locale)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatPaymentMethod(payment.method, payment.methodDetail, t('payment_method.other'))}
                      {payment.operationNumber && ` · ${payment.operationNumber}`}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge
                        tone={payment.procedureKind ? 'info' : 'neutral'}
                        label={t(`payment_origin.${payment.procedureKind ?? 'enrollment'}`)}
                      />
                      {payment.enrollmentCount > 1 && (
                        <StatusBadge
                          tone="info"
                          label={t('student_receipts.lot', { count: payment.enrollmentCount })}
                        />
                      )}
                    </span>
                    <span className="mt-1 block">{payment.courseNames.join(' · ')}</span>
                  </td>
                  <td className={tdClass}>
                    <span className={`tabular-nums font-semibold ${mismatch ? 'text-red-700' : ''}`}>
                      {formatMoney(payment.amountCents, payment.currency, locale)}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {t('student_receipts.expected', {
                        amount: formatMoney(payment.expectedAmountCents, payment.currency, locale),
                      })}
                    </span>
                    {payment.readAmountCents !== null && (
                      <span
                        className={`block text-xs tabular-nums ${readMismatch ? 'text-red-700' : 'text-muted-foreground'}`}
                      >
                        {t('student_receipts.read', {
                          amount: formatMoney(payment.readAmountCents, payment.currency, locale),
                        })}
                      </span>
                    )}
                  </td>
                  <td className={tdClass}>
                    {payment.verdict ? (
                      <StatusBadge
                        tone={verdictTone[payment.verdict]}
                        label={t(`review.verdict_short.${payment.verdict}`)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('student_receipts.no_verdict')}</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    <StatusBadge tone={paymentTone[payment.status]} label={t(`payment_status.${payment.status}`)} />
                    {payment.rejectionReason && (
                      <span className="mt-1 block text-xs text-red-700">
                        {t(`rejection_reason.${payment.rejectionReason}`)}
                      </span>
                    )}
                    {payment.decidedAt && (
                      <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                        {t('student_receipts.decided_at', { date: formatDateTime(payment.decidedAt, locale) })}
                      </span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {!payment.hasReceipt ? (
                      <span className="text-xs text-muted-foreground">{t('student_receipts.no_image')}</span>
                    ) : canOpenImage ? (
                      <button
                        type="button"
                        onClick={() => void openImage(payment)}
                        className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                      >
                        <BoIcon name="doc" size={14} />
                        {t('student_receipts.open_image')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableShell>
      )}

      <Dialog
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent closeLabel={t('payments.detail_close')} className="bg-white">
          {opened && (
            <>
              <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
                <DialogTitle className="text-base font-semibold text-ink">
                  {t('student_receipts.image_title')}
                </DialogTitle>
                <DialogDescription>
                  {t('student_receipts.image_subtitle', {
                    date: formatDateTime(opened.submittedAt, locale),
                    courses: opened.courseNames.join(' · '),
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="p-5">
                {image.kind === 'loading' && (
                  <p className="text-sm text-muted-foreground">{t('student_receipts.image_loading')}</p>
                )}
                {image.kind === 'unavailable' && (
                  <p role="alert" className="text-sm text-red-700">
                    {t('student_receipts.image_unavailable')}
                  </p>
                )}
                {image.kind === 'shown' && (
                  // A signed, five-minute URL straight from the bucket, as in
                  // Pagos: `next/image` would proxy and cache a link meant to
                  // expire. The bucket origin is in the CSP `img-src`.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.url}
                    alt={t('receipt_review.image_alt')}
                    className="mx-auto max-h-[70vh] max-w-full rounded-lg bg-white object-contain"
                  />
                )}
                <p className="mt-3 text-xs text-muted-foreground">{t('student_receipts.image_audit_note')}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
