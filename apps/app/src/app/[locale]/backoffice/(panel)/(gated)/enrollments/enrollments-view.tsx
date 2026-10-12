'use client'

import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EnrollmentRow } from '@/lib/backoffice/types'
import type { EnrollmentLedger } from '@/lib/backoffice/enrollments'
import {
  ENROLLMENT_LEDGER_STATES,
  enrollmentLedgerSearchParams,
  MIN_SEARCH_LENGTH,
  type EnrollmentLedgerQuery,
} from '@/lib/backoffice/enrollment-ledger-query'
import { formatDateTime, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Pager,
  StatCard,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import {
  classGroupTone,
  enrollmentTone,
  paymentTone,
  seatTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { ListStateTabs } from '@/components/backoffice/list-state-tabs'
import { EnrollmentDetailDialog } from './enrollment-detail-dialog'
import { NewEnrollmentForm, type StudentSearchResult } from './new-enrollment-form'
import { AutoGrid } from '@/components/layout/auto-grid'


/** What a link may preselect in the manual enrollment form — nothing priced. */
export interface EnrollmentPreselect {
  student: StudentSearchResult | null
  classGroupId: string | null
}

/** Long enough to finish a word, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 350

/**
 * The enrollment ledger. Newest first, like the payments one: this screen
 * answers "who came in", and the tab next door answers "who is still owed a
 * decision".
 *
 * It opens on the current tab (OOC-115) — seats in a class group still
 * selling or running, i.e. who is studying now. An enrollment whose class
 * group finished never leaves the ledger, only the default view.
 *
 * It shows the seat and the money side by side because that pair is the whole
 * job — a confirmed seat with an unsettled payment is the case coordination
 * has to catch, and it is invisible on either screen alone.
 *
 * Search, filters, sort and paging are the URL, and the URL is a query to
 * Postgres (`GET /api/v1/enrollments`): this component never holds more than
 * the page on screen. It used to filter the newest 500 rows in the browser,
 * which at 20k enrollments a month (CLAUDE.md §1) meant a filter panel that
 * only knew one language and one period, and a search that could not find
 * last month.
 */
export function EnrollmentsView({
  ledger,
  query,
  canCreate,
  preselect = null,
}: {
  ledger: EnrollmentLedger
  query: EnrollmentLedgerQuery
  canCreate: boolean
  /**
   * A link that arrives to open an enrollment (the class group's waitlist,
   * "enroll the first in line") — the form opens with these picked.
   */
  preselect?: EnrollmentPreselect | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  /**
   * A seat opened from this screen is re-read from the server, never drawn
   * from what the form happened to know. The browser is not the authority on
   * an enrollment (CLAUDE.md §8), and it does not hold the half the form never
   * sees: the code, the teacher on the roster, the period, the price version
   * the seat froze. This screen used to prepend a row it built itself, which
   * is why a reload made the new enrollment "disappear" — it had never been
   * read from Postgres in the first place.
   */
  const router = useRouter()
  const [creating, setCreating] = useState(canCreate && preselect !== null)
  const [toast, setToast] = useState<string | null>(null)

  const [detail, setDetail] = useState<EnrollmentRow | null>(null)

  const pathname = usePathname()
  /**
   * True while the server renders the page the reader just asked for. The
   * table stays on screen, dimmed, instead of blanking: the rows being
   * replaced are still the best answer until the new ones arrive.
   */
  const [pending, startTransition] = useTransition()

  /** Any change to the query goes back to page 1, unless it IS the page. */
  function navigate(next: Partial<EnrollmentLedgerQuery>, mode: 'push' | 'replace' = 'push') {
    const search = enrollmentLedgerSearchParams({ ...query, page: 1, ...next }).toString()
    const href = search ? `${pathname}?${search}` : pathname
    startTransition(() => {
      router[mode](href, { scroll: false })
    })
  }

  /**
   * The search box is typed into locally and reaches the URL after a pause —
   * a request per keystroke would be a full-ledger ILIKE per keystroke. Under
   * the API's minimum length it is not a search yet, so nothing is sent.
   */
  const [searchText, setSearchText] = useState(query.q)
  useEffect(() => {
    const needle = searchText.trim()
    if (needle === query.q) return
    if (needle.length > 0 && needle.length < MIN_SEARCH_LENGTH) return

    const timer = setTimeout(() => navigate({ q: needle }, 'replace'), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `navigate` closes over `query`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, query])

  const { items: pageRows, total, pageSize, metrics, filterOptions, counts } = ledger
  /** Only the "all" tab mixes both sides, so only there does a row need to
   * say which one it is on. */
  const showGroupStatus = query.state === 'all'

  const activeFilters = [query.language, query.period].filter(
    (value) => value !== null,
  ).length
  const narrowed = activeFilters > 0 || query.q !== ''

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(query.page, pageCount) - 1

  /**
   * The row opens the enrollment; the student's name stays a real link to the
   * file, for whoever came looking for the person instead of the seat.
   */
  function rowProps(row: EnrollmentRow) {
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        setDetail(row)
      },
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AutoGrid as="section" min="15rem" gap="gap-3">
        <StatCard
          icon="enrollments"
          tone="info"
          label={t('enrollments.metric_total')}
          value={String(metrics.total)}
          hint={t('enrollments.metric_total_hint', { period: metrics.periodName })}
        />
        <StatCard
          icon="check"
          tone="success"
          label={t('enrollments.metric_active')}
          value={String(metrics.active)}
          hint={t('enrollments.metric_active_hint')}
        />
      </AutoGrid>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* The counters come from the server, under the search and the other
            filters. */}
        <ListStateTabs
          label={t('enrollments.state_label')}
          active={query.state}
          onSelect={(state) => navigate({ state })}
          tabs={ENROLLMENT_LEDGER_STATES.map((state) => ({
            key: state,
            label: t(`enrollments.state_${state}`),
            count: counts[state],
          }))}
        />
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('enrollments.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('enrollments.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          {/* Four axes of chips would be taller than the table itself, so they
              live behind the button — same as the payments ledger. */}
          <FiltersDropdown
            label={t('enrollments.filters')}
            count={activeFilters}
            panelClassName="flex-col gap-3"
          >
            {/* Language is catalogue data, never a translated enum — the
                Asociación opens new ones and nothing language-specific belongs
                in the code (CLAUDE.md §1). The options come from the catalog,
                not from the rows on this page. */}
            <FilterRow label={t('enrollments.filter_language')}>
              <Chip
                active={query.language === null}
                onClick={() => navigate({ language: null })}
                label={t('enrollments.filter_all')}
              />
              {filterOptions.languages.map((language) => (
                <Chip
                  key={language}
                  active={query.language === language}
                  onClick={() => navigate({ language })}
                  label={language}
                />
              ))}
            </FilterRow>
            <FilterRow label={t('enrollments.filter_period')}>
              <Chip
                active={query.period === null}
                onClick={() => navigate({ period: null })}
                label={t('enrollments.filter_all')}
              />
              {filterOptions.periods.map((item) => (
                <Chip
                  key={item.id}
                  active={query.period === item.id}
                  onClick={() => navigate({ period: item.id })}
                  label={item.name}
                />
              ))}
            </FilterRow>
          </FiltersDropdown>

          <button
            type="button"
            onClick={() => navigate({ sort: query.sort === 'newest' ? 'oldest' : 'newest' })}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            <BoIcon name="sort" size={16} />
            {t(
              query.sort === 'newest'
                ? 'enrollments.sort_newest'
                : 'enrollments.sort_oldest',
            )}
          </button>

          {canCreate && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 self-start rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep lg:ml-auto"
            >
              <BoIcon name="plus" size={16} />
              {t('enrollments.new_enrollment')}
            </button>
          )}
        </Toolbar>

      </div>

      {creating && (
        <NewEnrollmentForm
          initialStudent={preselect?.student ?? null}
          initialClassGroupId={preselect?.classGroupId ?? null}
          onCancel={() => setCreating(false)}
          onCreate={() => {
            setCreating(false)
            /* A manual enrollment is born reserved and this ledger lists only
               confirmed seats, so the row will not show up here: the notice
               says where it went. */
            setToast(t('enrollments.created_sent_to_payments'))
            router.refresh()
          }}
        />
      )}

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={!narrowed ? 'enrollments' : 'search'}
              title={t(
                !narrowed
                  ? `enrollments.empty_${query.state}_title`
                  : 'enrollments.empty_search_title',
              )}
              body={t(
                !narrowed
                  ? `enrollments.empty_${query.state}_body`
                  : 'enrollments.empty_search_body',
              )}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('enrollments.col_student'),
                t('enrollments.col_course'),
                ...(showGroupStatus ? [t('enrollments.col_class_group_status')] : []),
                t('enrollments.col_status'),
                t('enrollments.col_seat'),
                t('enrollments.col_payment'),
                t('enrollments.col_created'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('enrollments.col_student')}</th>
                  <th className={thClass}>{t('enrollments.col_course')}</th>
                  {showGroupStatus && (
                    <th className={thClass}>{t('enrollments.col_class_group_status')}</th>
                  )}
                  <th className={thClass}>{t('enrollments.col_status')}</th>
                  <th className={thClass}>{t('enrollments.col_seat')}</th>
                  <th className={thClass}>{t('enrollments.col_payment')}</th>
                  <th className={thClass}>{t('enrollments.col_created')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} {...rowProps(row)}>
                    <td className={tdClass}>
                      <Link
                        href={`/backoffice/students/${row.studentId}`}
                        className="block max-w-[14rem] truncate font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {row.studentName}
                      </Link>
                      {/* The code the student was given at checkout. Under the
                          name because that is the pair support works with: a
                          person calls, reads the code, and this is where the
                          two are matched. */}
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {row.code}
                      </span>
                    </td>

                    {/* Course over class group, in that order: the course is
                        what was bought and the class group is which of its
                        instances the person sits in. */}
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

                    {showGroupStatus && (
                      <td className={tdClass}>
                        <StatusBadge
                          tone={classGroupTone[row.classGroupStatus]}
                          label={t(`class_group_status.${row.classGroupStatus}`)}
                        />
                      </td>
                    )}

                    <td className={tdClass}>
                      <StatusBadge
                        tone={enrollmentTone[row.status]}
                        label={t(`enrollment_status.${row.status}`)}
                      />
                    </td>

                    <td className={tdClass}>
                      <StatusBadge
                        tone={seatTone[row.seatStatus]}
                        label={t(`seat_status.${row.seatStatus}`)}
                      />
                    </td>

                    <td className={tdClass}>
                      <StatusBadge
                        tone={paymentTone[row.paymentStatus]}
                        label={t(`payment_status.${row.paymentStatus}`)}
                      />
                    </td>

                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      {formatDateTime(row.createdAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('enrollments.page_status', {
                  page: currentPage + 1,
                  pages: pageCount,
                })}
                prevLabel={t('enrollments.page_prev')}
                nextLabel={t('enrollments.page_next')}
                onChange={(page) => navigate({ page: page + 1 })}
              />
            )}
          </>
        )}
      </Card>

      <EnrollmentDetailDialog
        enrollment={detail}
        onClose={() => setDetail(null)}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/** One labelled axis of the filter panel. */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-brand-blue text-white'
          : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
