'use client'

import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { PaymentRow } from '@/lib/backoffice/types'
import type { PaymentLedger } from '@/lib/backoffice/payments'
import {
  MIN_SEARCH_LENGTH,
  PAYMENT_LEDGER_STATES,
  PAYMENT_METHODS,
  paymentLedgerSearchParams,
  statusesOf,
  type PaymentLedgerQuery,
} from '@/lib/backoffice/payment-ledger-query'
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
import { ListStateTabs } from '@/components/backoffice/list-state-tabs'
import { PaymentDetailDialog } from './payment-detail-dialog'
import { AutoGrid } from '@/components/layout/auto-grid'

/** Long enough to finish a word, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 350

/**
 * The ledger: every payment the institution received. Newest first here, the
 * opposite of the review queue: this screen answers "what came in", the queue
 * answers "what is somebody still waiting on".
 *
 * It opens on the open tab (OOC-114) — the money still owed a decision. A
 * decided payment never leaves the ledger, only the default view: it is one
 * tab away, read by when it was decided.
 *
 * Search, filters, sort and paging are the URL, and the URL is a query to
 * Postgres (`GET /api/v1/payments`): this component never holds more than the
 * page on screen — up to 20k receipts a month in peak season (CLAUDE.md §1).
 */
export function PaymentsView({
  ledger,
  query,
  canReview,
}: {
  ledger: PaymentLedger
  query: PaymentLedgerQuery
  /** Whether the viewer settles payments — draws the dialog's way to the queue. */
  canReview: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [detail, setDetail] = useState<PaymentRow | null>(null)

  const router = useRouter()
  const pathname = usePathname()
  /**
   * True while the server renders the page the reader just asked for. The
   * table stays on screen, dimmed, instead of blanking: the rows being
   * replaced are still the best answer until the new ones arrive.
   */
  const [pending, startTransition] = useTransition()

  /** Any change to the query goes back to page 1, unless it IS the page. */
  function navigate(next: Partial<PaymentLedgerQuery>, mode: 'push' | 'replace' = 'push') {
    const search = paymentLedgerSearchParams({ ...query, page: 1, ...next }).toString()
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

  const { items: pageRows, total, pageSize, metrics, counts } = ledger
  const closedTab = query.state === 'closed'

  const activeFilters = [query.status, query.method].filter(
    (value) => value !== null,
  ).length
  const narrowed = activeFilters > 0 || query.q !== ''

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(query.page, pageCount) - 1

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
        {/* The age of the oldest open payment is the hint only when something
            is open — "oldest waiting 0 h" over an empty queue is a number
            that means nothing. */}
        <StatCard
          icon="alert"
          tone="warning"
          label={t('payments.metric_in_review')}
          value={String(metrics.inReview)}
          hint={
            metrics.oldestOpenHours === null
              ? undefined
              : t('payments.metric_oldest_hint', { hours: metrics.oldestOpenHours })
          }
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
        {/* The tab drops the fine status: one from the other tab would be an
            empty list. The counters come from the server, under the search
            and the other filters. */}
        <ListStateTabs
          label={t('payments.state_label')}
          active={query.state}
          onSelect={(state) => navigate({ state, status: null })}
          tabs={PAYMENT_LEDGER_STATES.map((state) => ({
            key: state,
            label: t(`payments.state_${state}`),
            count: state === 'all' ? counts.open + counts.closed : counts[state],
          }))}
        />
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
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('payments.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          {/* Two axes of chips would be taller than the table itself, so they
              live behind the button — same as the enrollment ledger. */}
          <FiltersDropdown
            label={t('payments.filters')}
            count={activeFilters}
            panelClassName="flex-col gap-3"
          >
            <FilterRow label={t('payments.filter_status')}>
              <Chip
                active={query.status === null}
                onClick={() => navigate({ status: null })}
                label={t('payments.filter_all')}
              />
              {statusesOf(query.state).map((value) => (
                <Chip
                  key={value}
                  active={query.status === value}
                  onClick={() => navigate({ status: value })}
                  label={t(`payment_status.${value}`)}
                />
              ))}
            </FilterRow>
            <FilterRow label={t('payments.filter_method')}>
              <Chip
                active={query.method === null}
                onClick={() => navigate({ method: null })}
                label={t('payments.filter_all')}
              />
              {PAYMENT_METHODS.map((value) => (
                <Chip
                  key={value}
                  active={query.method === value}
                  onClick={() => navigate({ method: value })}
                  /* Rail names are proper nouns — never translated
                     (CLAUDE.md §4 glossary). Everything that came in by some
                     other route is one chip, named in the reader's language. */
                  label={formatPaymentMethod(value, null, t('payment_method.other'))}
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
            {t(query.sort === 'newest' ? 'payments.sort_newest' : 'payments.sort_oldest')}
          </button>
        </Toolbar>
      </div>

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {pageRows.length === 0 ? (
          <div className="p-4">
            {/* An empty open tab is the good news of this screen — said as
                such, not as "no payments yet". */}
            <EmptyState
              icon={narrowed ? 'search' : query.state === 'open' ? 'check' : 'payments'}
              title={t(narrowed ? 'payments.empty_search_title' : `payments.empty_${query.state}_title`)}
              body={t(narrowed ? 'payments.empty_search_body' : `payments.empty_${query.state}_body`)}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('payments.col_student'),
                t('payments.col_course'),
                t('payments.col_amount'),
                t('payments.col_status'),
                t('payments.col_operation'),
                t(closedTab ? 'payments.col_decided' : 'payments.col_submitted'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('payments.col_student')}</th>
                  <th className={thClass}>{t('payments.col_course')}</th>
                  <th className={thClass}>{t('payments.col_amount')}</th>
                  <th className={thClass}>{t('payments.col_status')}</th>
                  <th className={thClass}>{t('payments.col_operation')}</th>
                  <th className={thClass}>
                    {t(closedTab ? 'payments.col_decided' : 'payments.col_submitted')}
                  </th>
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

                      {/* What was paid for. Every payment today belongs to an
                          enrollment, so it is the course. */}
                      <td className={tdClass}>
                        <span className="block max-w-[15rem] truncate text-sm text-ink">
                          {row.courseName}
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

                      {/* One badge, nothing under it. The rail, the operation
                          number and who settled it all live one click away in
                          the dialog: stacked on the row they turned a ledger
                          into four lines per payment. */}
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
                          {formatPaymentMethod(
                            row.method,
                            row.methodDetail,
                            t('payment_method.other'),
                          )}
                        </span>
                      </td>

                      {/* The closed tab is ordered by the decision, so the
                          column shows it — when, and who. */}
                      <td
                        className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                      >
                        {closedTab && row.decidedAt ? (
                          <>
                            {formatDateTime(row.decidedAt, locale)}
                            <span className="block text-xs">
                              {row.decidedByName ?? t('payments.decided_by_unknown')}
                            </span>
                          </>
                        ) : (
                          formatDateTime(row.submittedAt, locale)
                        )}
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
                onChange={(page) => navigate({ page: page + 1 })}
              />
            )}
          </>
        )}
      </Card>

      <PaymentDetailDialog
        payment={detail}
        canReview={canReview}
        onClose={() => setDetail(null)}
      />
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
