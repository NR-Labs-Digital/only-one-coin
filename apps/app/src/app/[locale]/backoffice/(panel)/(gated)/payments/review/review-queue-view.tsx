'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type MouseEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { PaymentReviewItem, ReviewDecision } from '@/lib/backoffice/types'
import {
  MIN_SEARCH_LENGTH,
  reviewQueueSearchParams,
  type ReviewQueueQuery,
} from '@/lib/backoffice/payment-ledger-query'
import { approvePayment, rejectPayment, rereadReceipt } from '@/lib/backoffice/payment-client'
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
import { fraudSignalTone, receiptStateTone, verdictTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  ReceiptReviewDialog,
  deadlineState,
  type DecideOutcome,
  type RereadOutcome,
} from './receipt-review-dialog'
import { CASE_SHORTCUTS, QUEUE_SHORTCUTS, ShortcutList, isTypingTarget } from './shortcuts'

/** Long enough to finish a word, short enough to feel like typing. */
const SEARCH_DEBOUNCE_MS = 350

/** How often the queue is re-read while a re-read is with the model. */
const REREAD_POLL_MS = 4000

/**
 * The queue as a work list. By default the cases that most need a person
 * come first — suggested rejection, then review, then green, the least
 * confident reading first within each (ROADMAP Sessão 32); arrival order is
 * one click away.
 *
 * The row triages; the decision happens in the dialog, next to the receipt
 * image and to what the student declared. Settling a payment from a list is
 * how a mismatch gets approved because the row looked like the one above it.
 *
 * Worked from the keyboard (`./shortcuts`): J/K walk the rows, Enter opens
 * one, and inside the case J/K walk on. A decision opens the next case by
 * itself, so a run of reviews never needs the mouse.
 *
 * Search, order and paging are the URL, and the URL is a query to Postgres
 * (`GET /api/v1/payments/review`): this component never holds more than the
 * page on screen. A decision goes to the API and the page is re-rendered from
 * the server — the row leaves because the payment is settled, not because the
 * browser dropped it.
 */
export function ReviewQueueView({
  items,
  total,
  pageSize,
  query,
  canReview,
  openReceiptId,
  renderedAt,
  lowConfidencePercent,
}: {
  items: PaymentReviewItem[]
  /** Open payments matching the query, across every page. */
  total: number
  pageSize: number
  query: ReviewQueueQuery
  canReview: boolean
  /**
   * One payment to open on arrival — another screen sent the reader straight
   * to it. Honoured only if it is on this page and they may settle it: a link
   * is a request, not a permission (CLAUDE.md §8).
   */
  openReceiptId?: string | null
  /** When the server rendered the page — what the deadline is measured from. */
  renderedAt: number
  /** The OCR confidence floor (`platform_settings`, OOC-41); null if unread. */
  lowConfidencePercent: number | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()

  const [reviewingId, setReviewingId] = useState<string | null>(() =>
    canReview && openReceiptId && items.some((item) => item.id === openReceiptId)
      ? openReceiptId
      : null,
  )
  /**
   * The case on screen, kept even when a refresh no longer lists it — it was
   * settled by someone else, and the dialog says so when the reader acts.
   */
  const lastReviewed = useRef<PaymentReviewItem | null>(null)
  const listed = reviewingId ? items.find((item) => item.id === reviewingId) : undefined
  if (listed) lastReviewed.current = listed
  const reviewing = reviewingId
    ? (listed ?? (lastReviewed.current?.id === reviewingId ? lastReviewed.current : null))
    : null

  /** The keyboard's row, while no case is open. */
  const [cursor, setCursor] = useState(0)
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const [legend, setLegend] = useState(false)

  const [toast, setToast] = useState<string | null>(null)
  const [toastLong, setToastLong] = useState(false)
  const dismissToast = useCallback(() => setToast(null), [])

  /**
   * True while the server renders the page the reader just asked for. The
   * table stays on screen, dimmed, instead of blanking.
   */
  const [pending, startTransition] = useTransition()

  /** Any change to the query goes back to page 1, unless it IS the page. */
  function navigate(next: Partial<ReviewQueueQuery>, mode: 'push' | 'replace' = 'push') {
    const search = reviewQueueSearchParams({ ...query, page: 1, ...next }).toString()
    const href = search ? `${pathname}?${search}` : pathname
    startTransition(() => {
      router[mode](href, { scroll: false })
    })
  }

  /**
   * Typed into locally, sent after a pause — a request per keystroke would be
   * a full-queue ILIKE per keystroke. Under the API's minimum length it is not
   * a search yet, so nothing is sent.
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(query.page, pageCount) - 1

  /** Re-reads the queue from the server, keeping the table on screen meanwhile. */
  const refreshQueue = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  // A re-read is answered by a worker within seconds: while one is on its
  // way, the page keeps asking, so the new reading lands without a reload.
  const rereadWaiting = items.some((item) => item.rereadRequestedAt !== null)
  useEffect(() => {
    if (!rereadWaiting) return
    const timer = setInterval(refreshQueue, REREAD_POLL_MS)
    return () => clearInterval(timer)
  }, [rereadWaiting, refreshQueue])

  /**
   * Stepping past the page's edge loads the next (or previous) page and
   * opens its first (or last) case once it arrives.
   */
  const openOnArrival = useRef<'first' | 'last' | null>(null)
  useEffect(() => {
    const edge = openOnArrival.current
    if (!edge || items.length === 0) return
    openOnArrival.current = null
    setReviewingId(edge === 'first' ? items[0]!.id : items[items.length - 1]!.id)
  }, [items])

  // The cursor follows the list as it changes under it.
  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, items.length - 1)))
  }, [items.length])

  const reviewingIndex = reviewingId ? items.findIndex((item) => item.id === reviewingId) : -1

  function step(direction: 1 | -1) {
    if (reviewingIndex < 0) return
    const next = items[reviewingIndex + direction]
    if (next) {
      setReviewingId(next.id)
      return
    }
    const page = currentPage + 1 + direction
    if (page < 1 || page > pageCount) return
    openOnArrival.current = direction === 1 ? 'first' : 'last'
    navigate({ page })
  }
  const canStepForward = reviewingIndex >= 0 && (reviewingIndex < items.length - 1 || currentPage + 1 < pageCount)
  const canStepBack = reviewingIndex > 0 || (reviewingIndex === 0 && currentPage > 0)

  function closeCase() {
    if (reviewingIndex >= 0) setCursor(reviewingIndex)
    setReviewingId(null)
  }

  async function decide(paymentId: string, decision: ReviewDecision): Promise<DecideOutcome> {
    const result =
      decision.kind === 'approve'
        ? await approvePayment(paymentId)
        : await rejectPayment(paymentId, decision.reason, decision.note)

    if (result.ok) {
      // On to the next case: the one after this, or the one before when this
      // was the last row. A run of reviews is A, A, R…, never a click back to
      // the list. The page re-read from the server fills the gap behind it.
      const index = items.findIndex((item) => item.id === paymentId)
      const next = items[index + 1] ?? items[index - 1] ?? null
      setReviewingId(next?.id ?? null)
      if (!next && total > 1) openOnArrival.current = 'first'
      setCursor(Math.max(0, index))

      const conflict =
        decision.kind === 'approve' &&
        'portalAccess' in result.data &&
        result.data.portalAccess === 'email_conflict'
      // The conflict toast is the only one that asks for action, so it stays longer.
      setToastLong(conflict)
      setToast(
        t(
          decision.kind === 'approve'
            ? conflict
              ? 'review.approved_portal_conflict_toast'
              : 'review.approved_toast'
            : 'review.rejected_toast',
        ),
      )
      refreshQueue()
      return { kind: 'done' }
    }
    switch (result.error) {
      // The case changed under the reader: somebody else decided it, it left
      // the queue, or its seat went back to the class group. None of that is a
      // success, so it is not a toast — the dialog stays open and says so,
      // while the queue behind it is re-read.
      case 'already_settled':
      case 'not_found':
      case 'seat_released':
        refreshQueue()
        return { kind: 'notice', notice: result.error }
      default:
        return { kind: 'error' }
    }
  }

  async function reread(paymentId: string): Promise<RereadOutcome> {
    const result = await rereadReceipt(paymentId)
    if (result.ok) {
      refreshQueue()
      return { kind: 'queued' }
    }
    switch (result.error) {
      case 'reread_in_progress':
        refreshQueue()
        return { kind: 'in_progress' }
      case 'already_settled':
      case 'not_found':
        refreshQueue()
        return { kind: 'notice', notice: result.error }
      case 'receipt_not_rereadable':
        return { kind: 'not_rereadable' }
      default:
        return { kind: 'error' }
    }
  }

  /**
   * The list's keys, while no case is open — the dialog has its own. Read
   * through a ref so the one listener always sees the current rows.
   */
  function onKey(event: KeyboardEvent) {
    if (reviewingId || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) {
      if (event.key === 'Escape') (event.target as HTMLElement).blur()
      return
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const handled = (() => {
      switch (key) {
        case 'j':
        case 'ArrowDown':
          setCursor((current) => Math.min(current + 1, items.length - 1))
          return true
        case 'k':
        case 'ArrowUp':
          setCursor((current) => Math.max(current - 1, 0))
          return true
        case 'Enter':
        case 'o': {
          const item = items[cursor]
          if (!canReview || !item) return false
          setReviewingId(item.id)
          return true
        }
        case '/':
          searchRef.current?.focus()
          return true
        case '?':
          setLegend((current) => !current)
          return true
        case 'Escape':
          if (!legend) return false
          setLegend(false)
          return true
        default:
          return false
      }
    })()
    if (handled) event.preventDefault()
  }
  const onKeyRef = useRef(onKey)
  useEffect(() => {
    onKeyRef.current = onKey
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    if (reviewingId) return
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor, reviewingId])

  /**
   * The row opens the payment, it does not leave the queue. Sending a reviewer
   * to the student file mid-triage loses the page and the place in the list.
   * The button in the last column is the keyboard path; this only covers the
   * mouse.
   */
  function rowProps(item: PaymentReviewItem, index: number) {
    const selected = index === cursor
    return {
      ref: (row: HTMLTableRowElement | null) => {
        rowRefs.current[index] = row
      },
      'aria-selected': selected,
      className: `${selected ? 'bg-sky-soft shadow-[inset_3px_0_0_var(--color-brand-blue)]' : ''} ${
        canReview ? 'cursor-pointer transition hover:bg-sky-soft' : ''
      }`,
      onClick: canReview
        ? (event: MouseEvent<HTMLTableRowElement>) => {
            if ((event.target as HTMLElement).closest('a,button')) return
            setCursor(index)
            setReviewingId(item.id)
          }
        : undefined,
    }
  }

  const columns = [
    t('review.col_student'),
    t('review.col_course'),
    t('receipt_review.check_expected'),
    t('review.col_verdict'),
    t('review.col_submitted'),
    t('review.col_deadline'),
    t('review.col_receipt'),
    t('review.col_signals'),
    '',
  ]

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <label className={toolbarSearchClass}>
          <span className="sr-only">{t('review_queue.search_label')}</span>
          <BoIcon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('review_queue.search_placeholder')}
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
          />
        </label>

        <button
          type="button"
          onClick={() => navigate({ sort: query.sort === 'priority' ? 'oldest' : 'priority' })}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="sort" size={16} />
          {t(query.sort === 'priority' ? 'review_queue.sort_priority' : 'review_queue.sort_oldest')}
        </button>

        <button
          type="button"
          onClick={() => setLegend((current) => !current)}
          aria-expanded={legend}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="help" size={16} />
          {t('shortcuts.button')}
        </button>
      </Toolbar>

      {legend && (
        <Card className="grid gap-6 p-4 sm:grid-cols-2">
          <ShortcutList title={t('shortcuts.queue_title')} shortcuts={QUEUE_SHORTCUTS} />
          <ShortcutList title={t('shortcuts.case_title')} shortcuts={CASE_SHORTCUTS} />
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('shortcuts.note')}</p>
        </Card>
      )}

      {/* min-w-0: the row is wide enough to push a flex child past the page,
          and the scroll belongs to the table, never to the page. */}
      <Card
        className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`}
        aria-busy={pending}
      >
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={query.q ? 'search' : 'check'}
              title={t(query.q ? 'review_queue.empty_search_title' : 'review.empty_title')}
              body={t(query.q ? 'review_queue.empty_search_body' : 'review.empty_body')}
            />
          </div>
        ) : (
          <>
            <TableShell columns={columns}>
              <thead>
                <tr>
                  {columns.slice(0, -1).map((label) => (
                    <th key={label} className={thClass}>
                      {label}
                    </th>
                  ))}
                  <th className={thClass}>
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const deadline = deadlineState(item.reviewDeadline, renderedAt)
                  return (
                    <tr key={item.id} {...rowProps(item, index)}>
                      <td className={tdClass}>
                        <span className="block max-w-[14rem] truncate font-semibold text-ink">
                          {item.studentName}
                        </span>
                      </td>

                      {/* The class group rides under the course: it says which
                          seat the payment is holding. */}
                      <td className={tdClass}>
                        <span className="block max-w-[15rem]">
                          <span className="block truncate text-sm text-ink">
                            {item.courseName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.classGroupName}
                          </span>
                        </span>
                      </td>

                      <td className={`${tdClass} whitespace-nowrap font-semibold tabular-nums`}>
                        {formatMoney(item.expectedAmountCents, item.currency, locale)}
                      </td>

                      {/* What the order is made of: the traffic light, and the
                          shakiest of the three fields it decided on. */}
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {item.verdict ? (
                          <StatusBadge
                            tone={verdictTone[item.verdict.verdict]}
                            label={t(`review.verdict_short.${item.verdict.verdict}`)}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('review_queue.no_verdict')}
                          </span>
                        )}
                        {item.confidence !== null && (
                          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                            {t('review_queue.confidence', { value: Math.round(item.confidence * 100) })}
                          </span>
                        )}
                        {item.rereadRequestedAt && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t('review_queue.reread_pending')}
                          </span>
                        )}
                      </td>

                      <td
                        className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                      >
                        {formatDateTime(item.submittedAt, locale)}
                      </td>

                      {/* Red from a day out: the window closing is what the
                          reviewer needs to see before it happens. */}
                      <td
                        className={`${tdClass} whitespace-nowrap text-sm tabular-nums ${
                          deadline !== 'ok'
                            ? 'font-semibold text-red-600'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {formatDateTime(item.reviewDeadline, locale)}
                        {deadline === 'overdue' && (
                          <span className="block text-xs">{t('review.deadline_overdue')}</span>
                        )}
                      </td>

                      <td className={tdClass}>
                        <StatusBadge
                          tone={receiptStateTone[item.receipt]}
                          label={t(`receipt_state.${item.receipt}`)}
                        />
                      </td>

                      <td className={tdClass}>
                        {item.fraudSignals.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {item.fraudSignals.map((signal) => (
                              <StatusBadge
                                key={signal}
                                tone={fraudSignalTone[signal]}
                                label={t(`fraud_signal.${signal}`)}
                              />
                            ))}
                          </span>
                        )}
                      </td>

                      <td className={`${tdClass} whitespace-nowrap text-right`}>
                        {canReview && (
                          <button
                            type="button"
                            onClick={() => {
                              setCursor(index)
                              setReviewingId(item.id)
                            }}
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
                onChange={(page) => navigate({ page: page + 1 })}
              />
            )}
          </>
        )}
      </Card>

      <ReceiptReviewDialog
        payment={reviewing}
        renderedAt={renderedAt}
        lowConfidencePercent={lowConfidencePercent}
        onClose={closeCase}
        onDecide={decide}
        onReread={reread}
        onNext={canStepForward ? () => step(1) : null}
        onPrev={canStepBack ? () => step(-1) : null}
      />
      <Toast message={toast} onDismiss={dismissToast} duration={toastLong ? 9000 : undefined} />
    </div>
  )
}
