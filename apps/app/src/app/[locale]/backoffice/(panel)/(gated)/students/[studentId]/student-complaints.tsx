import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { ComplaintRow } from '@/lib/backoffice/complaints'
import { formatDate, type Locale } from '@/lib/format'
import { Card, SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { HelpHint } from '@/components/backoffice/help-hint'
import { complaintTone } from '@/components/backoffice/complaint-tone'

/**
 * The complaints book sheets filed with this student's document (OOC-58).
 * Drawn only for who reads the book; null rows is a failed read, said as such.
 */
export async function StudentComplaints({ rows, locale }: { rows: ComplaintRow[] | null; locale: Locale }) {
  const t = await getTranslations('bo')

  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="flex items-center gap-1.5">
        <SectionTitle>{t('complaints.student_block_title')}</SectionTitle>
        <HelpHint what={t('help.complaint_student_what')} how={t('help.complaint_student_how')} />
      </span>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t('complaints.student_block_error')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('complaints.student_block_empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <Link
                  href={`/backoffice/complaints/${row.id}`}
                  className="font-semibold text-brand-blue hover:underline"
                >
                  {row.code}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {`${t(`complaints.kind.${row.kind}`)} · ${formatDate(row.filedAt, locale)}`}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                <StatusBadge tone={complaintTone[row.status]} label={t(`complaints.status.${row.status}`)} />
                {row.overdue && <StatusBadge tone="danger" label={t('complaints.overdue')} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
