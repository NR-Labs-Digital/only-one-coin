'use client'

import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  EnrollmentMetrics,
  EnrollmentRow,
  EnrollmentStatus,
  SeatStatus,
} from '@/lib/backoffice/types'
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
  enrollmentTone,
  paymentTone,
  seatTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { EnrollmentDetailDialog } from './enrollment-detail-dialog'
import { NewEnrollmentForm } from './new-enrollment-form'
import { AutoGrid } from '@/components/layout/auto-grid'

type StatusFilter = EnrollmentStatus | 'all'
type SeatFilter = SeatStatus | 'all'

/** The states as they are worked, not alphabetically: open ones first. */
const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'under_review',
  'active',
  'completed',
  'rejected',
]

const SEAT_FILTERS: SeatFilter[] = ['all', 'reserved', 'confirmed', 'released']

const PAGE_SIZE = 15

/**
 * The enrollment ledger. Newest first, like the payments one: this screen
 * answers "who came in", and the tab next door answers "who is still owed a
 * decision".
 *
 * It shows the seat and the money side by side because that pair is the whole
 * job — a confirmed seat with an unsettled payment is the case coordination
 * has to catch, and it is invisible on either screen alone.
 *
 * Search, filters and paging run in the browser only because the dataset is
 * mocked; with the real API this becomes a server query (up to 20k enrollments
 * a month in peak season, CLAUDE.md §1).
 */
export function EnrollmentsView({
  rows,
  metrics,
  canCreate,
}: {
  rows: EnrollmentRow[]
  metrics: EnrollmentMetrics
  canCreate: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  /**
   * Enrollments opened from this screen are prepended locally. Screen-local on
   * purpose: the real write is a usecase in `packages/domain` behind
   * `apps/api`, with its own audit entry — the browser is never the authority
   * on a seat (CLAUDE.md §8).
   */
  const [created, setCreated] = useState<EnrollmentRow[]>([])
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [detail, setDetail] = useState<EnrollmentRow | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [seat, setSeat] = useState<SeatFilter>('all')
  const [languageId, setLanguageId] = useState<string>('all')
  const [period, setPeriod] = useState<string>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(0)

  const all = useMemo(() => [...created, ...rows], [created, rows])

  /** Filter options come from the data, not from a list kept in sync by hand. */
  const languages = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of all) {
      if (row.language) map.set(row.language.id, row.language.name)
    }
    return [...map].map(([id, name]) => ({ id, name }))
  }, [all])

  const periods = useMemo(
    () => [...new Set(all.map((row) => row.academicPeriodName))],
    [all],
  )

  const activeFilters = [status, seat, languageId, period].filter(
    (value) => value !== 'all',
  ).length

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = all.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (seat !== 'all' && row.seatStatus !== seat) return false
      if (languageId !== 'all' && row.language?.id !== languageId) return false
      if (period !== 'all' && row.academicPeriodName !== period) return false
      if (!needle) return true
      return [
        row.code,
        row.studentName,
        row.courseName,
        row.classGroupName,
        row.teacherName,
        row.operationNumber ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    // The source hands the list over newest first; oldest is a reversal, not a
    // second sort key.
    return sort === 'newest' ? list : [...list].reverse()
  }, [all, query, status, seat, languageId, period, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  )

  /** Any filter change sends the reader back to the first page. */
  function reset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(0)
    }
  }

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
          value={String(metrics.total + created.length)}
          hint={t('enrollments.metric_total_hint', { period: metrics.periodName })}
        />
        <StatCard
          icon="check"
          tone="success"
          label={t('enrollments.metric_active')}
          value={String(metrics.active)}
          hint={t('enrollments.metric_active_hint')}
        />
        {/* The reservation count carries its own deadline: a seat held is a
            seat nobody else can buy, and the number only means something next
            to how soon it comes back. */}
        <StatCard
          icon="clock"
          tone="warning"
          label={t('enrollments.metric_reserved')}
          value={String(metrics.reserved)}
          hint={t('enrollments.metric_reserved_hint', {
            count: metrics.expiringSoon,
          })}
        />
        <StatCard
          icon="seat"
          tone="neutral"
          label={t('enrollments.metric_released')}
          value={String(metrics.released)}
          hint={t('enrollments.metric_released_hint')}
        />
      </AutoGrid>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
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
              value={query}
              onChange={(event) => reset(setQuery)(event.target.value)}
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
            <FilterRow label={t('enrollments.filter_status')}>
              {STATUS_FILTERS.map((value) => (
                <Chip
                  key={value}
                  active={status === value}
                  onClick={() => reset(setStatus)(value)}
                  label={
                    value === 'all'
                      ? t('enrollments.filter_all')
                      : t(`enrollment_status.${value}`)
                  }
                />
              ))}
            </FilterRow>
            <FilterRow label={t('enrollments.filter_seat')}>
              {SEAT_FILTERS.map((value) => (
                <Chip
                  key={value}
                  active={seat === value}
                  onClick={() => reset(setSeat)(value)}
                  label={
                    value === 'all'
                      ? t('enrollments.filter_all')
                      : t(`seat_status.${value}`)
                  }
                />
              ))}
            </FilterRow>
            {/* Language is catalogue data, never a translated enum — the
                Asociación opens new ones and nothing language-specific belongs
                in the code (CLAUDE.md §1). */}
            <FilterRow label={t('enrollments.filter_language')}>
              <Chip
                active={languageId === 'all'}
                onClick={() => reset(setLanguageId)('all')}
                label={t('enrollments.filter_all')}
              />
              {languages.map((item) => (
                <Chip
                  key={item.id}
                  active={languageId === item.id}
                  onClick={() => reset(setLanguageId)(item.id)}
                  label={item.name}
                />
              ))}
            </FilterRow>
            <FilterRow label={t('enrollments.filter_period')}>
              <Chip
                active={period === 'all'}
                onClick={() => reset(setPeriod)('all')}
                label={t('enrollments.filter_all')}
              />
              {periods.map((item) => (
                <Chip
                  key={item}
                  active={period === item}
                  onClick={() => reset(setPeriod)(item)}
                  label={item}
                />
              ))}
            </FilterRow>
          </FiltersDropdown>

          <button
            type="button"
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            <BoIcon name="sort" size={16} />
            {t(
              sort === 'newest'
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
          onCancel={() => setCreating(false)}
          onCreate={(row) => {
            setCreated((current) => [row, ...current])
            setCreating(false)
            setPage(0)
            setToast(t('new_enrollment.created'))
          }}
        />
      )}

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card className="min-w-0">
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={all.length === 0 ? 'enrollments' : 'search'}
              title={t(
                all.length === 0
                  ? 'enrollments.empty_title'
                  : 'enrollments.empty_search_title',
              )}
              body={t(
                all.length === 0
                  ? 'enrollments.empty_body'
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
                onChange={setPage}
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
