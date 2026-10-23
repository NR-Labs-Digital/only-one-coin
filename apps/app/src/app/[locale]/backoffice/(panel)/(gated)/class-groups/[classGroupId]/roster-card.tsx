import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { ClassGroupRoster } from '@/lib/backoffice/types'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { paymentTone } from '@/components/backoffice/status-tone'

/**
 * Who is enrolled in this class group — the confirmed seats, read from
 * `GET /catalog/class-groups/:id/roster`. Read-only: grades, procedures and the
 * certificate batch build on this list later, they do not live here yet.
 *
 * The API decides the columns by role: national id, contact and the link to
 * the student file only reach who reads the file (`view: "full"`). The screen
 * draws what came, it never decides who sees a DNI.
 *
 * `null` is a failed read and says so — an empty list here would read as
 * "nobody enrolled", which may be false.
 */
export function RosterCard({ roster }: { roster: ClassGroupRoster | null }) {
  const t = useTranslations('bo')

  if (!roster) {
    return (
      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">{t('roster.title')}</p>
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t('roster.load_error')}
        </p>
      </Card>
    )
  }

  const full = roster.view === 'full'
  // Columns that exist only in the full view enter the stacked labels under
  // the same condition — the label matches the cell by position.
  const columns = [
    t('roster.col_student'),
    ...(full ? [t('roster.col_document'), t('roster.col_contact')] : []),
    t('roster.col_plan'),
    t('roster.col_payment'),
  ]

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-5">
        <p className="text-sm font-semibold text-ink">{t('roster.title')}</p>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t('roster.count', { count: roster.items.length })}
        </span>
      </div>
      {!full && <p className="px-5 pt-1 text-xs text-muted-foreground">{t('roster.limited_note')}</p>}

      {roster.items.length === 0 ? (
        <p className="px-5 pb-5 pt-3 text-sm text-muted-foreground">{t('roster.empty')}</p>
      ) : (
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
              {roster.items.map((item) => (
                <tr key={item.enrollmentId}>
                  <td className={`${tdClass} font-medium`}>
                    {full ? (
                      <Link
                        href={`/backoffice/students/${item.studentId}`}
                        aria-label={`${t('roster.open_file')}: ${item.studentName}`}
                        className="text-brand-blue transition hover:text-brand-blue-deep"
                      >
                        {item.studentName}
                      </Link>
                    ) : (
                      item.studentName
                    )}
                  </td>
                  {full && item.file && (
                    <>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                        {t('students.document', {
                          type: t(`national_id_type.${item.file.nationalIdType}`),
                          number: item.file.nationalId,
                        })}
                      </td>
                      <td className={tdClass}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{item.file.email}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {item.file.phone}
                          </span>
                        </span>
                      </td>
                    </>
                  )}
                  <td className={tdClass}>{item.planName}</td>
                  <td className={tdClass}>
                    {item.paymentStatus ? (
                      <StatusBadge
                        tone={paymentTone[item.paymentStatus]}
                        label={t(`payment_status.${item.paymentStatus}`)}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('roster.no_payment')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </Card>
  )
}
