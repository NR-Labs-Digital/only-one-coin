import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseStudents, canViewComplaints } from '@/lib/backoffice/permissions'
import { listComplaints, type ComplaintRow, type ComplaintStatus } from '@/lib/backoffice/complaints'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import { Card, EmptyState, PageHeader, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { HelpHint } from '@/components/backoffice/help-hint'
import { complaintTone } from '@/components/backoffice/complaint-tone'

/** `open` is what still waits for the team: not taken, or taken and not answered. */
const TABS = ['open', 'received', 'in_progress', 'answered', 'all'] as const
type Tab = (typeof TABS)[number]

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const inputClass =
  'min-h-tap rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-brand-blue sm:min-h-0'

/**
 * The complaints book (OOC-58): every sheet filed from the public form, the
 * newest first. Opens on what still waits for the team — the rest is a tab
 * away, with its count (the same rule as Payments, OOC-113). The status, the
 * deadline and the link to a student file come from the API, never stored.
 */
export default async function ComplaintsPage({
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
  if (!canViewComplaints(staff)) notFound()

  const query = await searchParams
  const tabRaw = one(query.tab) as Tab | undefined
  const tab: Tab = tabRaw && TABS.includes(tabRaw) ? tabRaw : 'open'
  const q = one(query.q)?.trim() || undefined
  const overdue = one(query.overdue) === 'true'

  const inbox = await listComplaints({ overdue, q })
  const counts = inbox?.counts
  const rows = (inbox?.items ?? []).filter((row) =>
    tab === 'all' ? true : tab === 'open' ? row.status !== 'answered' : row.status === (tab as ComplaintStatus),
  )

  const tabCount = (value: Tab): number | undefined => {
    if (!counts) return undefined
    if (value === 'all') return counts.received + counts.in_progress + counts.answered
    if (value === 'open') return counts.received + counts.in_progress
    return counts[value]
  }

  const hrefOf = (value: Tab) => {
    const next = new URLSearchParams()
    if (value !== 'open') next.set('tab', value)
    if (q) next.set('q', q)
    if (overdue) next.set('overdue', 'true')
    const suffix = next.toString()
    return suffix ? `/backoffice/complaints?${suffix}` : '/backoffice/complaints'
  }

  const columns = [
    t('complaints.col_code'),
    t('complaints.col_consumer'),
    t('complaints.col_kind'),
    t('complaints.col_status'),
    t('complaints.col_deadline'),
  ]
  const days = inbox?.responseBusinessDays
  const columnHelp: ({ what: string; how: string } | null)[] = [
    null,
    { what: t('help.complaint_student_what'), how: t('help.complaint_student_how') },
    { what: t('help.complaint_kind_what'), how: t('help.complaint_kind_how') },
    { what: t('help.complaint_status_what'), how: t('help.complaint_status_how') },
    days !== undefined
      ? { what: t('help.complaint_deadline_what', { days }), how: t('help.complaint_deadline_how') }
      : null,
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('complaints.title')}
        actions={<HelpHint what={t('help.complaint_page_what')} how={t('help.complaint_page_how')} />}
      />
      {days !== undefined && <p className="text-sm text-muted-foreground">{t('complaints.intro', { days })}</p>}

      <div className="flex items-end gap-1.5">
        <nav className={`${tabStripClass} min-w-0 flex-1`}>
          {TABS.map((value) => {
            const count = tabCount(value)
            return (
              <Link
                key={value}
                href={hrefOf(value)}
                aria-current={tab === value ? 'page' : undefined}
                className={tabClass(tab === value)}
              >
                {t(`complaints.tab_${value}`)}
                {count !== undefined && (
                  <span className={tab === value ? 'text-brand-blue/60' : 'text-slate-400'}>{count}</span>
                )}
              </Link>
            )
          })}
        </nav>
        <span className="pb-2">
          <HelpHint what={t('help.complaint_tabs_what')} how={t('help.complaint_tabs_how')} />
        </span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {tab !== 'open' && <input type="hidden" name="tab" value={tab} />}
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground sm:max-w-sm">
          {t('complaints.search_label')}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder={t('complaints.search_placeholder')}
            className={inputClass}
          />
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink sm:min-h-0 sm:pb-2">
          <input type="checkbox" name="overdue" value="true" defaultChecked={overdue} />
          {t('complaints.filter_overdue')}
          {counts && counts.overdue > 0 && (
            <span className="text-xs font-semibold text-red-700">{counts.overdue}</span>
          )}
        </label>
        <button
          type="submit"
          className="min-h-tap rounded-lg bg-brand-blue px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-blue-deep sm:min-h-0"
        >
          {t('complaints.filter_apply')}
        </button>
      </form>

      {inbox === null ? (
        <Card className="p-4">
          <EmptyState icon="alert" title={t('complaints.load_error')} body={t('class_groups.load_error_body')} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon="check" title={t('complaints.empty_title')} body={t('complaints.empty_body')} />
        </Card>
      ) : (
        <Card>
          <TableShell columns={columns}>
            <thead>
              <tr>
                {columns.map((label, index) => {
                  const help = columnHelp[index]
                  return (
                    <th key={label} className={thClass}>
                      {help ? (
                        <span className="inline-flex items-center gap-1.5">
                          {label}
                          <HelpHint what={help.what} how={help.how} />
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
                <ComplaintTableRow
                  key={row.id}
                  row={row}
                  locale={locale as Locale}
                  opensFiles={canBrowseStudents(staff)}
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

function ComplaintTableRow({
  row,
  locale,
  opensFiles,
  t,
}: {
  row: ComplaintRow
  locale: Locale
  /** Support reads the book but not the student files: the name, without a link to a 404. */
  opensFiles: boolean
  t: Awaited<ReturnType<typeof getTranslations<'bo'>>>
}) {
  return (
    <tr>
      <td className={tdClass}>
        <Link href={`/backoffice/complaints/${row.id}`} className="font-semibold text-brand-blue hover:underline">
          {row.code}
        </Link>
        <span className="block text-xs text-muted-foreground">{formatDateTime(row.filedAt, locale)}</span>
      </td>
      <td className={tdClass}>
        <span className="block font-medium">{row.consumerName}</span>
        <span className="block text-xs text-muted-foreground">
          {`${t(`national_id_type.${row.consumerNationalIdType}`)} ${row.consumerNationalId}`}
          {row.consumerIsMinor && ` · ${t('complaints.minor')}`}
        </span>
        {row.student && !opensFiles ? (
          <span className="block text-xs text-muted-foreground">
            {t('complaints.student_link', { name: row.student.fullName })}
          </span>
        ) : row.student ? (
          <Link
            href={`/backoffice/students/${row.student.studentId}`}
            className="block text-xs font-semibold text-brand-blue hover:underline"
          >
            {t('complaints.student_link', { name: row.student.fullName })}
          </Link>
        ) : (
          <span className="block text-xs text-muted-foreground">{t('complaints.no_student')}</span>
        )}
      </td>
      <td className={tdClass}>
        {t(`complaints.kind.${row.kind}`)}
        <span className="block text-xs text-muted-foreground">{t(`complaints.good_type.${row.goodType}`)}</span>
      </td>
      <td className={tdClass}>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone={complaintTone[row.status]} label={t(`complaints.status.${row.status}`)} />
          {row.overdue && <StatusBadge tone="danger" label={t('complaints.overdue')} />}
          {row.answeredLate && <StatusBadge tone="warning" label={t('complaints.answered_late')} />}
        </span>
      </td>
      <td className={tdClass}>
        <span className="block">{t('complaints.due_on', { date: formatDate(row.dueOn, locale) })}</span>
        {row.status !== 'answered' && !row.overdue && (
          <span className="block text-xs text-muted-foreground">
            {t('complaints.days_left', { count: row.businessDaysLeft })}
          </span>
        )}
        {row.answered && (
          <span className="block text-xs text-muted-foreground">
            {t('complaints.answered_on', { date: formatDate(row.answered.at, locale) })}
          </span>
        )}
      </td>
    </tr>
  )
}
