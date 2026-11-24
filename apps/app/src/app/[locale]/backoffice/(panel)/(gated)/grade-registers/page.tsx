import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseCatalog, canReadGrades } from '@/lib/backoffice/permissions'
import { listCatalogPeriods } from '@/lib/backoffice/catalog'
import {
  listGradeRegisters,
  type GradeRegisterRow,
  type GradeRegisterStatus,
} from '@/lib/backoffice/grade-registers'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import { AcademicTabs } from '@/components/backoffice/academic-tabs'
import { registerTone } from '@/components/grades/grade-register-summary'

const STATUS_FILTERS = ['open', 'draft', 'in_review', 'returned', 'official', 'all'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const selectClass =
  'min-h-tap rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-brand-blue sm:min-h-0'

/**
 * The grade registers across class groups (OOC-180 step 6, the screen OOC-170
 * asked for): which module groups still owe their register, which wait for
 * coordination's review, and which teachers are out of time. Opens on what is
 * open — not sent, in review, returned —; official ones are a filter away.
 * Only class groups running or finished, as the API reads them.
 *
 * The teacher and module filters are built from the rows themselves, so the
 * analyst — who reads grades but not the teacher roster — gets them too.
 */
export default async function GradeRegistersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')
  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff) || !canReadGrades(staff)) notFound()

  const query = await searchParams
  const period = one(query.period) || undefined
  const teacher = one(query.teacher) || undefined
  const moduleRaw = Number(one(query.module))
  const module = Number.isInteger(moduleRaw) && moduleRaw > 0 ? moduleRaw : undefined
  const statusRaw = one(query.status) as StatusFilter | undefined
  const status: StatusFilter = statusRaw && STATUS_FILTERS.includes(statusRaw) ? statusRaw : 'open'
  const overdue = one(query.overdue) === 'true'

  const [result, periods] = await Promise.all([
    listGradeRegisters({
      period,
      status: status === 'open' || status === 'all' ? undefined : (status as GradeRegisterStatus),
      overdue,
    }),
    listCatalogPeriods(),
  ])

  const all = result?.items ?? []
  const teachers = [
    ...new Map(
      all.filter((row) => row.teacherId).map((row) => [row.teacherId!, row.teacherName ?? row.teacherId!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const modules = [
    ...new Set(all.map((row) => row.module).filter((value): value is number => value !== null)),
  ].sort((a, b) => a - b)
  const rows = all
    .filter((row) => (status === 'open' ? row.status !== 'official' : true))
    .filter((row) => (teacher ? row.teacherId === teacher : true))
    .filter((row) => (module ? row.module === module : true))
    // Out of time first, then the oldest deadline — the to-do order.
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) || (a.deadlineAt ?? '~').localeCompare(b.deadlineAt ?? '~'),
    )

  const columns = [
    t('grade_register.col_class_group'),
    t('grade_register.col_module'),
    t('grade_register.col_teacher'),
    t('grade_register.col_grades'),
    t('grade_register.col_status'),
    t('grade_register.col_deadline'),
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <AcademicTabs />
      <p className="text-sm text-muted-foreground">
        {t('grade_register.list_intro', {
          hours: result?.submissionHours ?? 48,
        })}
      </p>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('grade_register.filter_period')}
          <select name="period" defaultValue={period ?? ''} className={selectClass}>
            <option value="">{t('grade_register.filter_all')}</option>
            {(periods ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('grade_register.filter_teacher')}
          <select name="teacher" defaultValue={teacher ?? ''} className={selectClass}>
            <option value="">{t('grade_register.filter_all')}</option>
            {teachers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('grade_register.filter_module')}
          <select name="module" defaultValue={module ? String(module) : ''} className={selectClass}>
            <option value="">{t('grade_register.filter_all')}</option>
            {modules.map((number) => (
              <option key={number} value={number}>
                {t('class_group_runs.module_label', { number })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {t('grade_register.filter_status')}
          <select name="status" defaultValue={status} className={selectClass}>
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === 'open' || value === 'all'
                  ? t(`grade_register.filter_status_${value}`)
                  : t(`grade_register.status.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink sm:min-h-0 sm:pb-2">
          <input type="checkbox" name="overdue" value="true" defaultChecked={overdue} />
          {t('grade_register.filter_overdue')}
        </label>
        <button
          type="submit"
          className="min-h-tap rounded-lg bg-brand-blue px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep sm:min-h-0"
        >
          {t('grade_register.filter_apply')}
        </button>
      </form>

      {result === null ? (
        <Card className="p-4">
          <EmptyState
            icon="alert"
            title={t('grade_register.load_error')}
            body={t('class_groups.load_error_body')}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon="check"
            title={t('grade_register.list_empty_title')}
            body={t('grade_register.list_empty_body')}
          />
        </Card>
      ) : (
        <Card>
          <TableShell columns={columns}>
            <thead>
              <tr>
                {columns.map((label) => (
                  <th key={label} className={thClass}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RegisterRow
                  key={row.registerId ?? `${row.classGroupModuleId}-next`}
                  row={row}
                  locale={locale as Locale}
                  t={t}
                />
              ))}
            </tbody>
          </TableShell>
        </Card>
      )}
    </div>
  )
}

function RegisterRow({
  row,
  locale,
  t,
}: {
  row: GradeRegisterRow
  locale: Locale
  t: Awaited<ReturnType<typeof getTranslations<'bo'>>>
}) {
  return (
    <tr>
      <td className={tdClass}>
        <Link
          href={`/backoffice/class-groups/${row.classGroupId}`}
          className="font-semibold text-brand-blue hover:underline"
        >
          {row.classGroupCode}
        </Link>
        <span className="block text-xs text-muted-foreground">
          {`${row.courseName} · ${row.academicPeriodName}`}
        </span>
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
      <td className={tdClass}>
        {row.teacherName ?? <span className="text-muted-foreground">{t('grade_register.no_teacher')}</span>}
        <span className="block text-xs text-muted-foreground">
          {slotsLabel(row.slots ?? [], (key, values) => t(key as never, values as never))}
        </span>
      </td>
      <td className={`${tdClass} tabular-nums`}>
        {t('grade_register.progress', { graded: row.graded, total: row.total })}
      </td>
      <td className={tdClass}>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone={registerTone[row.status]} label={t(`grade_register.status.${row.status}`)} />
          {row.overdue && <StatusBadge tone="danger" label={t('grade_register.overdue')} />}
          {row.submittedLate && row.status !== 'draft' && (
            <StatusBadge tone="warning" label={t('grade_register.submitted_late')} />
          )}
        </span>
      </td>
      <td className={tdClass}>
        {row.moduleEndsOn === null ? (
          <span className="font-semibold text-amber-700">{t('grade_register.no_end_date')}</span>
        ) : (
          <>
            <span className="block text-xs text-muted-foreground">
              {t('grade_register.ends_on', {
                date: formatDate(row.moduleEndsOn, locale),
              })}
            </span>
            {row.deadlineAt && row.status !== 'official' && (
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
  )
}
