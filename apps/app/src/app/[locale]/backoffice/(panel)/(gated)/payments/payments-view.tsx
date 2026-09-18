'use client'

import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  PaymentMethod,
  PaymentMetrics,
  PaymentRow,
  PaymentStatus,
} from '@/lib/backoffice/types'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
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
import { paymentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { PaymentDetailDialog } from './payment-detail-dialog'
import { AutoGrid } from '@/components/layout/auto-grid'

type StatusFilter = PaymentStatus | 'all'
type MethodFilter = PaymentMethod | 'all'
type ConceptFilter = 'all' | 'course' | 'document'

/** The states as they are worked, not alphabetically: open ones first. */
const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'under_review',
  'pending',
  'approved',
  'rejected',
]

const METHOD_FILTERS: MethodFilter[] = [
  'all',
  'yape',
  'plin',
  'bcp',
  'interbank',
  'other',
]

const CONCEPT_FILTERS: ConceptFilter[] = ['all', 'course', 'document']

const PAGE_SIZE = 15

/**
 * The ledger: every payment the institution received, whatever it was for.
 * Enrollments and paid procedures share the list because `payments` is
 * agnostic of origin (CLAUDE.md §5) — the treasury closes the period over both
 * and would otherwise have to add up two screens.
 *
 * Newest first here, the opposite of the review queue: this screen answers
 * "what came in", the queue answers "what is somebody still waiting on".
 *
 * Search, filters and paging run in the browser only because the dataset is
 * mocked; with the real API this becomes a server query (up to 20k receipts a
 * month in peak season, CLAUDE.md §1).
 */
export function PaymentsView({
  rows,
  metrics,
}: {
  rows: PaymentRow[]
  metrics: PaymentMetrics
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [detail, setDetail] = useState<PaymentRow | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [method, setMethod] = useState<MethodFilter>('all')
  const [concept, setConcept] = useState<ConceptFilter>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(0)

  const activeFilters = [status, method, concept].filter(
    (value) => value !== 'all',
  ).length

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (method !== 'all' && row.method !== method) return false
      if (concept !== 'all' && row.concept.kind !== concept) return false
      if (!needle) return true
      const conceptText =
        row.concept.kind === 'course'
          ? row.concept.courseName
          : t(`document_type.${row.concept.type}`)
      return [row.studentName, conceptText, row.operationNumber ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    // The source hands the list over newest first; oldest is a reversal, not a
    // second sort key.
    return sort === 'newest' ? list : [...list].reverse()
  }, [rows, query, status, method, concept, sort, t])

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
   * The row opens the payment, not the student: this screen is the ledger, and
   * what a reader wants from a line is the receipt behind it. The name stays a
   * real link to the file for whoever came looking for the person instead.
   */
  function rowProps(row: PaymentRow) {
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
          icon="alert"
          tone="warning"
          label={t('payments.metric_in_review')}
          value={String(metrics.inReview)}
          hint={t('payments.metric_in_review_hint', {
            hours: metrics.oldestPendingHours,
          })}
        />
        <StatCard
          icon="check"
          tone="success"
          label={t('payments.metric_approved')}
          value={String(metrics.approved)}
          hint={t('payments.metric_approved_hint', { period: metrics.periodName })}
        />
        <StatCard
          icon="payments"
          tone="info"
          label={t('payments.metric_collected')}
          value={formatMoney(metrics.collectedCents, 'PEN', locale)}
          hint={t('payments.metric_collected_hint')}
        />
        <StatCard
          icon="close"
          tone="danger"
          label={t('payments.metric_rejected')}
          value={String(metrics.rejected)}
          hint={t('payments.metric_rejected_hint')}
        />
      </AutoGrid>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('payments.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => reset(setQuery)(event.target.value)}
              placeholder={t('payments.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          {/* Three axes of chips would be taller than the table itself, so
              they live behind the button — same as the alumnos list. */}
          <FiltersDropdown
            label={t('payments.filters')}
            count={activeFilters}
            panelClassName="flex-col gap-3"
          >
            <FilterRow label={t('payments.filter_status')}>
              {STATUS_FILTERS.map((value) => (
                <Chip
                  key={value}
                  active={status === value}
                  onClick={() => reset(setStatus)(value)}
                  label={
                    value === 'all'
                      ? t('payments.filter_all')
                      : t(`payment_status.${value}`)
                  }
                />
              ))}
            </FilterRow>
            <FilterRow label={t('payments.filter_concept')}>
              {CONCEPT_FILTERS.map((value) => (
                <Chip
                  key={value}
                  active={concept === value}
                  onClick={() => reset(setConcept)(value)}
                  label={
                    value === 'all'
                      ? t('payments.filter_all')
                      : t(`payments.concept_${value}`)
                  }
                />
              ))}
            </FilterRow>
            <FilterRow label={t('payments.filter_method')}>
              {METHOD_FILTERS.map((value) => (
                <Chip
                  key={value}
                  active={method === value}
                  onClick={() => reset(setMethod)(value)}
                  /* Rail names are proper nouns — never translated
                     (CLAUDE.md §4 glossary). Everything that came in by some
                     other route is one chip, named in the reader's language. */
                  label={
                    value === 'all'
                      ? t('payments.filter_all')
                      : formatPaymentMethod(value, null, t('payment_method.other'))
                  }
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
            {t(sort === 'newest' ? 'payments.sort_newest' : 'payments.sort_oldest')}
          </button>
        </Toolbar>

      </div>

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card className="min-w-0">
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={rows.length === 0 ? 'payments' : 'search'}
              title={t(
                rows.length === 0
                  ? 'payments.empty_title'
                  : 'payments.empty_search_title',
              )}
              body={t(
                rows.length === 0
                  ? 'payments.empty_body'
                  : 'payments.empty_search_body',
              )}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('payments.col_student'),
                t('payments.col_concept'),
                t('payments.col_amount'),
                t('payments.col_status'),
                t('payments.col_operation'),
                t('payments.col_submitted'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('payments.col_student')}</th>
                  <th className={thClass}>{t('payments.col_concept')}</th>
                  <th className={thClass}>{t('payments.col_amount')}</th>
                  <th className={thClass}>{t('payments.col_status')}</th>
                  <th className={thClass}>{t('payments.col_operation')}</th>
                  <th className={thClass}>{t('payments.col_submitted')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const mismatch = row.amountCents !== row.expectedAmountCents
                  return (
                    <tr key={row.id} {...rowProps(row)}>
                      <td className={tdClass}>
                        <Link
                          href={`/backoffice/students/${row.studentId}`}
                          className="block max-w-[14rem] truncate font-semibold text-ink transition hover:text-brand-blue"
                        >
                          {row.studentName}
                        </Link>
                      </td>

                      {/* What was paid for. The kind rides on top as a word,
                          because "Inglés Básico A1" and "Constancia" only look
                          alike until the treasury has to tell them apart. */}
                      <td className={tdClass}>
                        <span className="block max-w-[15rem]">
                          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                            {t(`payments.concept_${row.concept.kind}`)}
                          </span>
                          <span className="block truncate text-sm text-ink">
                            {row.concept.kind === 'course'
                              ? row.concept.courseName
                              : t(`document_type.${row.concept.type}`)}
                          </span>
                        </span>
                      </td>

                      <td className={`${tdClass} whitespace-nowrap`}>
                        <span
                          className={`font-semibold tabular-nums ${
                            mismatch ? 'text-red-600' : 'text-ink'
                          }`}
                        >
                          {formatMoney(row.amountCents, row.currency, locale)}
                        </span>
                        {/* The expected value only earns a line when it differs
                            — otherwise it is noise on every row. */}
                        {mismatch && (
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {t('review.expected', {
                              amount: formatMoney(
                                row.expectedAmountCents,
                                row.currency,
                                locale,
                              ),
                            })}
                          </span>
                        )}
                      </td>

                      {/* One badge, nothing under it. The flag, the rail, the
                          operation number and who settled it all live one
                          click away in the dialog: stacked on the row they
                          turned a ledger into four lines per payment. */}
                      <td className={tdClass}>
                        <StatusBadge
                          tone={paymentTone[row.status]}
                          label={t(`payment_status.${row.status}`)}
                        />
                      </td>

                      <td
                        className={`${tdClass} whitespace-nowrap text-xs text-muted-foreground`}
                      >
                        <span className="block font-semibold text-ink">
                          {row.method
                            ? formatPaymentMethod(
                                row.method,
                                null,
                                t('payment_method.other'),
                              )
                            : t('payments.no_method')}
                        </span>
                      </td>

                      <td
                        className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                      >
                        {formatDateTime(row.submittedAt, locale)}
                      </td>

                    </tr>
                  )
                })}
              </tbody>
            </TableShell>

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('payments.page_status', {
                  page: currentPage + 1,
                  pages: pageCount,
                })}
                prevLabel={t('payments.page_prev')}
                nextLabel={t('payments.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      <PaymentDetailDialog payment={detail} onClose={() => setDetail(null)} />
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
