import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupMonthlySeat } from '@/lib/backoffice/types'
import { formatDate, type Locale } from '@/lib/format'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'

const STATE_TONE = {
  paid: 'success',
  in_review: 'warning',
  due: 'danger',
  unknown: 'neutral',
} as const

/**
 * The monthly seats of this class group (OOC-86): who is up to date on the
 * module they are on, whose receipt waits in Payments, and who owes it and
 * since when. Read-only — money is settled in Payments, and owing a module is
 * never a debt: it only keeps that module's class closed in the portal.
 * Owing first, then in review, then the rest, so the list reads as an errand
 * list from the top.
 *
 * `null` is a failed read and says so; a class group with no monthly seat
 * shows no card at all.
 */
export function MonthlyCard({ seats }: { seats: ClassGroupMonthlySeat[] | null }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  if (seats === null) {
    return (
      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">{t('monthly.title')}</p>
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t('monthly.load_error')}
        </p>
      </Card>
    )
  }
  if (seats.length === 0) return null

  const order = { due: 0, in_review: 1, paid: 2, unknown: 3 }
  const sorted = [...seats].sort((a, b) => order[a.state] - order[b.state])
  const owing = seats.filter((seat) => seat.state === 'due').length
  const columns = [t('monthly.col_student'), t('monthly.col_module'), t('monthly.col_state'), t('monthly.col_ahead')]

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-5">
        <p className="text-sm font-semibold text-ink">{t('monthly.title')}</p>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t('monthly.owing_count', { count: owing, total: seats.length })}
        </span>
      </div>
      <p className="px-5 pt-1 text-xs text-muted-foreground">{t('monthly.note')}</p>
      <div className="mt-3">
        <TableShell columns={columns}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} className={thClass}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((seat) => (
              <tr key={seat.enrollmentId}>
                <td className={`${tdClass} font-medium`}>{seat.studentName}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                  {seat.module === null
                    ? '—'
                    : seat.attempt > 1
                      ? t('monthly.module_repeat', { n: seat.module })
                      : t('monthly.module', { n: seat.module })}
                </td>
                <td className={tdClass}>
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge tone={STATE_TONE[seat.state]} label={t(`monthly.state.${seat.state}`)} />
                    {seat.dueSince && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t('monthly.due_since', { date: formatDate(seat.dueSince, locale) })}
                      </span>
                    )}
                  </span>
                </td>
                <td className={`${tdClass} tabular-nums text-muted-foreground`}>
                  {seat.aheadModules.length > 0
                    ? t('monthly.ahead', { modules: seat.aheadModules.join(', ') })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>
    </Card>
  )
}
