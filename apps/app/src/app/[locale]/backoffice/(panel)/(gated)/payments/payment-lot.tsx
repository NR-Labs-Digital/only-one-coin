'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PaymentLotItem } from '@/lib/backoffice/types'
import { formatMoney, type Locale } from '@/lib/format'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'

/*
 * A lot (OOC-158): several courses — one student's, or several children's —
 * paid with one receipt. Payments lists it as one payment whose own student and
 * course are the lot's first item; these pieces put the others beside it, so
 * whoever decides sees everything the decision moves.
 */

/** The fields of the payment itself that the lot list needs for its first line. */
interface LotPayment {
  enrollmentId: string
  studentName: string
  courseName: string
  classGroupName?: string
  planName?: string
  expectedAmountCents: number
  currency: 'PEN'
  lot: PaymentLotItem[]
}

/** How many enrollments the payment pays for — 1 is an ordinary payment. */
export function lotSize(payment: { lot: PaymentLotItem[] }): number {
  return payment.lot.length + 1
}

/** The badge a lot carries next to the payment's status. */
export function LotBadge({ payment }: { payment: { lot: PaymentLotItem[] } }) {
  const t = useTranslations('bo')
  if (payment.lot.length === 0) return null
  return <StatusBadge tone="info" label={t('payment_lot.badge', { count: lotSize(payment) })} />
}

/** The short line a table row carries under the course, in place of the origin. */
export function LotLine({ payment }: { payment: { lot: PaymentLotItem[] } }) {
  const t = useTranslations('bo')
  return (
    <span className="block truncate text-xs font-semibold text-brand-blue">
      {t('payment_lot.line', { count: lotSize(payment) })}
    </span>
  )
}

/**
 * Every enrollment the payment pays for, the payment's own first, each with its
 * share of the receipt (the plan price it was sold at). Deciding the payment
 * decides all of them — the note says so before anybody clicks.
 */
export function LotEnrollments({ payment }: { payment: LotPayment }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  if (payment.lot.length === 0) return null

  const othersCents = payment.lot.reduce((total, item) => total + item.expectedAmountCents, 0)
  const rows = [
    {
      enrollmentId: payment.enrollmentId,
      studentName: payment.studentName,
      courseName: payment.courseName,
      classGroupName: payment.classGroupName,
      planName: payment.planName,
      // The payment's own share: the sum it expects, less the others'.
      expectedAmountCents: payment.expectedAmountCents - othersCents,
    },
    ...payment.lot,
  ]

  return (
    <section>
      <SectionTitle icon="enrollments">{t('payment_lot.title', { count: rows.length })}</SectionTitle>
      <p className="mt-2 text-xs text-muted-foreground">{t('payment_lot.note')}</p>
      <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
        {rows.map((row) => (
          <li key={row.enrollmentId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{row.studentName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[row.courseName, row.classGroupName, row.planName].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-ink">
              {formatMoney(row.expectedAmountCents, payment.currency, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
