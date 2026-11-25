import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { OwnGradeRegisterRow } from '@/lib/docente/teaching'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { registerTone } from '@/components/grades/register-tone'

/**
 * The teacher's grade registers still open (OOC-170): not sent, returned or in
 * review, with the deadline and whether it is out of time — the teacher's half
 * of Académico → Registros de notas, scoped to their own runs by the API. Out
 * of time first, then the nearest deadline. Official registers stay in each
 * class group. Nothing open, nothing shown; a failed read says so, never an
 * empty list that would read as "all sent".
 */
export async function OwnGradeRegisters({
  registers,
  locale,
}: {
  registers: { items: OwnGradeRegisterRow[]; submissionHours: number } | null
  locale: Locale
}) {
  const t = await getTranslations('bo')

  if (registers === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BoIcon name="alert" size={16} className="text-amber-700" />
        {t('teacher_home.registers_load_error')}
      </p>
    )
  }

  const open = registers.items
    .filter((row) => row.status !== 'official')
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.deadlineAt ?? '~').localeCompare(b.deadlineAt ?? '~'),
    )
  if (open.length === 0) return null

  const columns = [
    t('grade_register.col_class_group'),
    t('grade_register.col_module'),
    t('grade_register.col_grades'),
    t('grade_register.col_status'),
    t('grade_register.col_deadline'),
  ]
  /* One (?) per column that is not obvious (screen-help): the round, the
     count, the states and the deadline — never one per row. */
  const hints: Record<number, { what: string; how?: string }> = {
    1: { what: t('help.teach_register_round_what') },
    2: { what: t('help.teach_register_progress_what'), how: t('help.teach_register_progress_how') },
    3: { what: t('help.teach_register_status_what'), how: t('help.teach_register_status_how') },
    4: {
      what: t('help.teach_register_deadline_what', { hours: registers.submissionHours }),
      how: t('help.teach_register_deadline_how'),
    },
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <BoIcon name="check" size={16} className="text-brand-blue" />
          {t('teacher_home.registers_title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('teacher_home.registers_subtitle', { hours: registers.submissionHours })}
        </p>
      </div>

      <Card>
        <TableShell columns={columns}>
          <thead>
            <tr>
              {columns.map((label, index) => {
                const hint = hints[index]
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
            {open.map((row) => (
              <tr key={row.registerId ?? `${row.classGroupModuleId}-${row.round}`}>
                <td className={`${tdClass} whitespace-nowrap`}>
                  <Link
                    href={`/docente/class-groups/${row.classGroupModuleId}`}
                    className="font-semibold text-ink transition hover:text-brand-blue"
                  >
                    {row.courseName}
                  </Link>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {`${row.classGroupCode} · ${slotsLabel(row.slots ?? [], t)}`}
                  </p>
                </td>
                <td className={tdClass}>
                  {row.module === null
                    ? t('class_group_runs.no_module')
                    : t('class_group_runs.module_label', { number: row.module })}
                  {row.round > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {t('grade_register.round', { round: row.round })}
                    </span>
                  )}
                </td>
                <td className={`${tdClass} tabular-nums`}>
                  {t('grade_register.progress', { graded: row.graded, total: row.total })}
                </td>
                <td className={tdClass}>
                  <span className="flex flex-wrap gap-1.5">
                    <StatusBadge
                      tone={registerTone[row.status]}
                      label={t(`grade_register.status.${row.status}`)}
                    />
                    {row.overdue && (
                      <StatusBadge tone="danger" label={t('grade_register.overdue')} />
                    )}
                  </span>
                </td>
                <td className={tdClass}>
                  {row.moduleEndsOn === null ? (
                    <span className="font-semibold text-amber-700">
                      {t('grade_register.no_end_date')}
                    </span>
                  ) : (
                    <>
                      <span className="block text-xs text-muted-foreground">
                        {t('grade_register.ends_on', { date: formatDate(row.moduleEndsOn, locale) })}
                      </span>
                      {row.deadlineAt && (
                        <span className="block">
                          {t('grade_register.deadline', {
                            date: formatDateTime(row.deadlineAt, locale),
                          })}
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </section>
  )
}
