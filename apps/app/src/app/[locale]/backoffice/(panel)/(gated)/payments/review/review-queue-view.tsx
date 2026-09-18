'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ReceiptExtraction,
  ReviewDecision,
  ReviewFlag,
  ReviewQueueItem,
} from '@/lib/backoffice/types'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Pager,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  rowActionClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { reviewFlagTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { ReceiptReviewDialog } from './receipt-review-dialog'

type FlagFilter = ReviewFlag | 'all'

/** Same order as the tier ladder reads: hard blocks first, then the doubts. */
const FLAG_FILTERS: FlagFilter[] = [
  'all',
  'amount_mismatch',
  'duplicate_phash',
  'model_divergence',
  'low_confidence',
  'illegible',
]

const PAGE_SIZE = 15

/**
 * The queue as a work list. Default order is oldest first — a receipt waiting
 * is a student waiting, and the promise on the home card is that the queue is
 * worked from the oldest one.
 *
 * The row triages; the decision happens in the dialog, next to the image and to
 * what the model read. Settling a receipt from a list, on a flag alone, is how
 * a mismatch gets approved because the row looked like the one above it.
 *
 * The row carries only what sorts one case from another — who is waiting, how
 * much, why it stopped, since when. The rail and the operation number are read
 * against the image or not at all, so they wait for the click instead of
 * printing a number nobody can check from the list.
 *
 * Filtering and paging run in the browser only because the dataset is mocked;
 * with the real API this becomes a server query (up to 20k receipts a month in
 * peak season, CLAUDE.md §1).
 */
export function ReviewQueueView({
  rows,
  extractions,
  canReview,
  openReceiptId,
}: {
  rows: ReviewQueueItem[]
  /** The extraction behind each queued receipt, keyed by the queue row. */
  extractions: Record<string, ReceiptExtraction>
  canReview: boolean
  /**
   * One receipt to open on arrival — another screen sent the reader straight
   * to it. Honoured only if it is real and they may settle it: a link is a
   * request, not a permission (CLAUDE.md §8).
   */
  openReceiptId?: string | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  /** A settled receipt leaves the queue — that is the whole point of settling
   *  it. No server yet, so the removal lives here (see the mock notice). */
  const [queue, setQueue] = useState<ReviewQueueItem[]>(rows)
  const [reviewing, setReviewing] = useState<string | null>(() =>
    canReview && openReceiptId && extractions[openReceiptId] ? openReceiptId : null,
  )
  const [toast, setToast] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [flag, setFlag] = useState<FlagFilter>('all')
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest')
  const [page, setPage] = useState(0)

  const counts = useMemo(() => {
    const seed = { all: queue.length } as Record<FlagFilter, number>
    for (const value of FLAG_FILTERS) if (value !== 'all') seed[value] = 0
    for (const row of queue) seed[row.flag] += 1
    return seed
  }, [queue])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = queue.filter((row) => {
      if (flag !== 'all' && row.flag !== flag) return false
      if (!needle) return true
      return [row.studentName, row.courseName, row.operationNumber ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    // The server hands the list over oldest first; newest is a reversal, not a
    // second sort key.
    return sort === 'oldest' ? list : [...list].reverse()
  }, [queue, query, flag, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  )

  function search(value: string) {
    setQuery(value)
    setPage(0)
  }

  function filterByFlag(value: FlagFilter) {
    setFlag(value)
    setPage(0)
  }

  function decide(paymentId: string, decision: ReviewDecision) {
    setQueue((current) => current.filter((row) => row.id !== paymentId))
    setReviewing(null)
    setToast(
      t(
        decision.kind === 'approve'
          ? 'receipt_review.approved_toast'
          : 'receipt_review.rejected_toast',
      ),
    )
  }

  /**
   * The row opens the receipt, it does not leave the queue. Sending a reviewer
   * to the student file mid-triage loses the page, the filter and the place in
   * the list — and the dialog already carries everything the row was hiding.
   * The button in the last column is the keyboard path; this only covers the
   * mouse.
   */
  function rowProps(id: string) {
    const openable = canReview && Boolean(extractions[id])
    if (!openable) return {}
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a,button')) return
        setReviewing(id)
      },
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('review_queue.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => search(event.target.value)}
              placeholder={t('review_queue.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          {/* Six reasons is a row of chips wide enough to shove the table
              down the page — they live behind the button, like the alumnos
              list does. */}
          <FiltersDropdown
            label={t('review_queue.filters')}
            count={flag !== 'all' ? 1 : 0}
            panelClassName="flex-wrap items-center gap-1.5"
          >
            {FLAG_FILTERS.map((value) => {
              const active = flag === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => filterByFlag(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-brand-blue text-white'
                      : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
                  }`}
                >
                  {value === 'all'
                    ? t('review_queue.filter_all')
                    : t(`review_flag.${value}`)}
                  <span className={active ? 'text-white/70' : 'text-slate-400'}>
                    {counts[value]}
                  </span>
                </button>
              )
            })}
          </FiltersDropdown>

          <button
            type="button"
            onClick={() => setSort(sort === 'oldest' ? 'newest' : 'oldest')}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            <BoIcon name="sort" size={16} />
            {t(
              sort === 'oldest' ? 'review_queue.sort_oldest' : 'review_queue.sort_newest',
            )}
          </button>
        </Toolbar>

        {/* One axis only: the flag is what tells one case from another here. */}
      </div>

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card className="min-w-0">
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={queue.length === 0 ? 'check' : 'search'}
              title={t(
                queue.length === 0 ? 'review.empty_title' : 'review_queue.empty_search_title',
              )}
              body={t(
                queue.length === 0 ? 'review.empty_body' : 'review_queue.empty_search_body',
              )}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('review.col_student'),
                t('review.col_amount'),
                t('review.col_flag'),
                t('review.col_submitted'),
                '',
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('review.col_student')}</th>
                  <th className={thClass}>{t('review.col_amount')}</th>
                  <th className={thClass}>{t('review.col_flag')}</th>
                  <th className={thClass}>{t('review.col_submitted')}</th>
                  <th className={thClass}>
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const mismatch = row.amountCents !== row.expectedAmountCents
                  return (
                    <tr key={row.id} {...rowProps(row.id)}>
                      {/* Course rides under the name: it says which price the
                          receipt is being checked against, and as its own
                          column it pushed the table off the screen. */}
                      <td className={tdClass}>
                        <span className="block max-w-[15rem]">
                          <span className="block truncate font-semibold text-ink">
                            {row.studentName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.courseName}
                          </span>
                        </span>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <span
                          className={`font-semibold tabular-nums ${
                            mismatch ? 'text-red-600' : 'text-ink'
                          }`}
                        >
                          {formatMoney(row.amountCents, 'PEN', locale)}
                        </span>
                        {/* The expected value only earns a line when it differs
                            — otherwise it is noise on every row. */}
                        {mismatch && (
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {t('review.expected', {
                              amount: formatMoney(row.expectedAmountCents, 'PEN', locale),
                            })}
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <StatusBadge
                          tone={reviewFlagTone[row.flag]}
                          label={t(`review_flag.${row.flag}`)}
                        />
                      </td>
                      <td
                        className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                      >
                        {formatDateTime(row.submittedAt, locale)}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right`}>
                        {canReview && extractions[row.id] && (
                          <button
                            type="button"
                            onClick={() => setReviewing(row.id)}
                            className={rowActionClass}
                          >
                            {t('receipt_review.open')}
                            <BoIcon name="chevron-right" size={14} />
                          </button>
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
                status={t('review_queue.page_status', {
                  page: currentPage + 1,
                  pages: pageCount,
                })}
                prevLabel={t('review_queue.page_prev')}
                nextLabel={t('review_queue.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      <ReceiptReviewDialog
        extraction={reviewing ? (extractions[reviewing] ?? null) : null}
        onClose={() => setReviewing(null)}
        onDecide={decide}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
