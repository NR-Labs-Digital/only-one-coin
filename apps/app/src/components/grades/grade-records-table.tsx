import { getTranslations } from 'next-intl/server'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import type { GradeRecordRow, GradeRecordScope } from '@/lib/grade-records/types'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { HelpHint } from '@/components/backoffice/help-hint'
import { GradeRecordDownload } from './grade-record-download'

/**
 * The actas de notas (OOC-176) as a table — the panel's list and the teacher
 * portal's, one copy. Counts only, never a grade. The teacher column is the
 * panel's: the teacher portal only lists the teacher's own.
 */
export async function GradeRecordsTable({
  rows,
  scope,
  locale,
}: {
  rows: GradeRecordRow[]
  scope: GradeRecordScope
  locale: Locale
}) {
  const t = await getTranslations('bo')
  const withTeacher = scope === 'staff'

  const columns = [
    t('grade_register.col_class_group'),
    t('grade_register.col_module'),
    ...(withTeacher ? [t('grade_register.col_teacher')] : []),
    t('grade_record.col_counts'),
    t('grade_record.col_confirmed'),
    t('grade_record.col_action'),
  ]
  /* One (?) per column that carries a rule (screen-help). */
  const hints: Record<string, { what: string; how?: string }> = {
    [t('grade_record.col_counts')]: {
      what: t('help.grade_record_counts_what'),
      how: t('help.grade_record_counts_how'),
    },
    [t('grade_record.col_confirmed')]: {
      what: t('help.grade_record_confirmed_what'),
      how: t('help.grade_record_confirmed_how'),
    },
    [t('grade_record.col_action')]: {
      what: t('help.grade_record_download_what'),
      how: t('help.grade_record_download_how'),
    },
  }

  return (
    <Card>
      <TableShell columns={columns}>
        <thead>
          <tr>
            {columns.map((label) => {
              const hint = hints[label]
              return (
                <th key={label} className={thClass}>
                  {hint ? (
                    <span className="inline-flex items-center gap-1.5">
                      {label}
                      <HelpHint what={hint.what} how={hint.how} />
                    </span>
                  ) : (
                    label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.registerId}>
              <td className={tdClass}>
                <span className="font-semibold">{row.classGroupCode}</span>
                <span className="block text-xs text-muted-foreground">
                  {`${row.courseName} · ${row.academicPeriodName}`}
                </span>
              </td>
              <td className={tdClass}>
                <div className="min-w-0">
                  {row.module === null
                    ? t('class_group_runs.no_module')
                    : t('class_group_runs.module_label', { number: row.module })}
                  {row.round > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {t('grade_register.round', { round: row.round })}
                    </span>
                  )}
                </div>
              </td>
              {withTeacher && (
                <td className={tdClass}>
                  {row.teacherName ?? (
                    <span className="text-muted-foreground">{t('grade_register.no_teacher')}</span>
                  )}
                </td>
              )}
              <td className={`${tdClass} tabular-nums`}>
                {/* One block per cell: stacked on a phone the cell is a flex
                    row, and loose lines would sit side by side. */}
                <div className="min-w-0">
                  <span className="block">{t('grade_record.students', { count: row.students })}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('grade_record.breakdown', {
                      passed: row.passed,
                      failed: row.failed,
                      didNotSit: row.didNotSit,
                    })}
                  </span>
                </div>
              </td>
              <td className={tdClass}>
                <div className="min-w-0">
                  <span className="block">{formatDateTime(row.confirmedAt, locale)}</span>
                  {row.confirmedByName && (
                    <span className="block text-xs text-muted-foreground">
                      {t('grade_record.confirmed_by', { name: row.confirmedByName })}
                    </span>
                  )}
                  {row.correctedAt && (
                    <span className="mt-1 flex">
                      <StatusBadge
                        tone="warning"
                        label={t('grade_record.corrected_on', { date: formatDate(row.correctedAt, locale) })}
                      />
                    </span>
                  )}
                </div>
              </td>
              <td className={tdClass}>
                <GradeRecordDownload scope={scope} registerId={row.registerId} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  )
}
