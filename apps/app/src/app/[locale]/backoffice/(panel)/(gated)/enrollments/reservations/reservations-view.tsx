'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { SeatReservation } from '@/lib/backoffice/types'
import { RESERVATION_WARNING_HOURS } from '@/lib/backoffice/mock-data'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  rowActionClass,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import {
  paymentTone,
  reviewFlagTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * Seats held by an open payment, soonest to expire first. No search, no
 * filters, no paging: this is a worklist that should be short, and a screen
 * that needs a filter to be read is a screen admitting the queue got away.
 *
 * The countdown arrives computed from the server clock — see the page.
 */
export function ReservationsView({
  rows,
  reservationDays,
}: {
  rows: SeatReservation[]
  reservationDays: number
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          icon="seat"
          title={t('reservations.empty_title')}
          body={t('reservations.empty_body')}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <BoIcon name="clock" size={14} className="mt-0.5 shrink-0" />
        {t('reservations.rule', { days: reservationDays })}
      </p>

      <Card className="min-w-0">
        <TableShell
          columns={[
            t('reservations.col_student'),
            t('reservations.col_course'),
            t('reservations.col_amount'),
            t('reservations.col_payment'),
            t('reservations.col_deadline'),
            '',
          ]}
        >
          <thead>
            <tr>
              <th className={thClass}>{t('reservations.col_student')}</th>
              <th className={thClass}>{t('reservations.col_course')}</th>
              <th className={thClass}>{t('reservations.col_amount')}</th>
              <th className={thClass}>{t('reservations.col_payment')}</th>
              <th className={thClass}>{t('reservations.col_deadline')}</th>
              <th className={thClass}>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.enrollmentId}>
                <td className={tdClass}>
                  <Link
                    href={`/backoffice/students/${row.studentId}`}
                    className="block max-w-[14rem] truncate font-semibold text-ink transition hover:text-brand-blue"
                  >
                    {row.studentName}
                  </Link>
                </td>

                <td className={tdClass}>
                  <span className="block max-w-[16rem]">
                    <span className="block truncate text-sm font-medium text-ink">
                      {row.courseName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.classGroupName}
                    </span>
                  </span>
                </td>

                <td
                  className={`${tdClass} whitespace-nowrap font-semibold tabular-nums`}
                >
                  {formatMoney(row.amountCents, row.currency, locale)}
                </td>

                {/* The payment state, and why it is stuck when the ladder
                    already said why: a reservation waiting on an illegible
                    photo is chased differently from one waiting on an upload
                    that never came. */}
                <td className={tdClass}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      tone={paymentTone[row.paymentStatus]}
                      label={t(`payment_status.${row.paymentStatus}`)}
                    />
                    {row.flag && (
                      <StatusBadge
                        tone={reviewFlagTone[row.flag]}
                        dot={false}
                        label={t(`review_flag.${row.flag}`)}
                      />
                    )}
                  </span>
                </td>

                <td className={`${tdClass} whitespace-nowrap`}>
                  <Deadline hoursLeft={row.hoursLeft} />
                  <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(row.expiresAt, locale)}
                  </span>
                </td>

                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  {/* Settling it is the review queue's job, next to the image
                      and what the model read — never a click on this list
                      (CLAUDE.md §8). What the click owes the reader is *this*
                      receipt: dropping them into the queue to find the same
                      row again is asking them to do the search twice. When
                      nothing has been uploaded yet there is no receipt to
                      open, and the queue itself is the honest destination. */}
                  <Link
                    href={
                      row.reviewId
                        ? `/backoffice/payments/review?receipt=${row.reviewId}`
                        : '/backoffice/payments/review'
                    }
                    className={rowActionClass}
                  >
                    {t('reservations.open_review')}
                    <BoIcon name="chevron-right" size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  )
}

/**
 * How long the seat has left. Past the deadline it is not "0 h": the cron may
 * not have run yet, and telling a coordinator the seat is gone when it is still
 * there — or the reverse — is the one thing this column must not do.
 */
function Deadline({ hoursLeft }: { hoursLeft: number }) {
  const t = useTranslations('bo')

  if (hoursLeft < 0) {
    return (
      <StatusBadge
        tone="danger"
        dot={false}
        label={t('reservations.overdue', { hours: -hoursLeft })}
      />
    )
  }

  const urgent = hoursLeft <= RESERVATION_WARNING_HOURS
  // Under a day the reader needs hours; over it, days — "97 h" is nobody's
  // unit for "four days".
  const label =
    hoursLeft < 24
      ? t('reservations.left_hours', { hours: hoursLeft })
      : t('reservations.left_days', { days: Math.floor(hoursLeft / 24) })

  return (
    <StatusBadge tone={urgent ? 'warning' : 'neutral'} dot={false} label={label} />
  )
}
