'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  PaymentReviewItem,
  ReadField,
  ReceiptReading,
  RejectionReason,
  ReviewDecision,
  ReviewVerdict,
} from '@/lib/backoffice/types'
import { fetchReceiptUrl } from '@/lib/backoffice/payment-client'
import { formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { paymentTone, receiptStateTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CASE_SHORTCUTS, KEY_CTRL, KEY_ENTER, Kbd, ShortcutList, isTypingTarget } from './shortcuts'

/** Offered in the order a reviewer usually meets them. */
const REASONS: RejectionReason[] = [
  'amount_mismatch',
  'illegible',
  'duplicate',
  'not_a_receipt',
  'other',
]

/** Mirrors the API's cap on the rejection note. */
const NOTE_MAX_LENGTH = 500

/** Under a day left on the review window, the deadline turns red. */
const DEADLINE_WARNING_MS = 24 * 60 * 60 * 1000

/** How close a payment is to overstaying its review window. */
export function deadlineState(
  reviewDeadline: string,
  renderedAt: number,
): 'ok' | 'soon' | 'overdue' {
  const left = new Date(reviewDeadline).getTime() - renderedAt
  if (left <= 0) return 'overdue'
  return left < DEADLINE_WARNING_MS ? 'soon' : 'ok'
}

/**
 * Why a decision did not go through although nothing failed: the case changed
 * under the reader. Said in the dialog, never as a success toast.
 */
export type CaseNotice = 'already_settled' | 'not_found' | 'seat_released'

/**
 * What the dialog hears back from a decision. `done` means the queue already
 * closed it; `notice` keeps it open with an amber note on what changed;
 * `error` keeps it open with a retryable failure.
 */
export type DecideOutcome =
  | { kind: 'done' }
  | { kind: 'notice'; notice: CaseNotice }
  | { kind: 'error' }

/**
 * What the dialog hears back from asking for a new reading (Sessão 32).
 * `queued` and `in_progress` both mean a reading is on its way; the others
 * say why none is.
 */
export type RereadOutcome =
  | { kind: 'queued' }
  | { kind: 'in_progress' }
  | { kind: 'notice'; notice: CaseNotice }
  | { kind: 'not_rereadable' }
  | { kind: 'error' }

/** Long enough for the queue to come back with the request on it; a worker
 * that answered faster than that already shows the new reading. */
const REREAD_ASKED_MS = 15_000

/** Where the receipt image stands while the dialog is open. */
type ImageState =
  | { kind: 'loading' }
  | { kind: 'shown'; url: string }
  | { kind: 'unavailable' }

/**
 * Where a payment is actually settled: the receipt image, what the student
 * declared, the frozen price it is checked against and what the antifraud
 * screening found. This is the one place a payment changes state — the
 * student file stays read-only, because approving is a usecase with its own
 * audit entry, not a click on a profile (CLAUDE.md §8).
 *
 * The image comes through a short-lived signed URL, asked for only when the
 * dialog opens on a receipt that is ready: every request for it is an audited
 * read on the server, so the list never prefetches it.
 *
 * A centred modal, the same shape the ledger opens a payment with: the queue
 * stays behind it, and the case gets the middle of the screen.
 *
 * Worked from the keyboard (Sessão 32, `./shortcuts`): each shortcut is the
 * button it names and nothing more, so A approves exactly like the click,
 * and R only opens the rejection form, which still asks for its own
 * confirmation.
 */
export function ReceiptReviewDialog({
  payment,
  renderedAt,
  onClose,
  onDecide,
  onReread,
  onNext,
  onPrev,
}: {
  payment: PaymentReviewItem | null
  /** When the server rendered the queue — what the deadline is measured from. */
  renderedAt: number
  onClose: () => void
  /** Resolves once the API answered; the dialog stays disabled until then. */
  onDecide: (paymentId: string, decision: ReviewDecision) => Promise<DecideOutcome>
  /** Asks for a new OCR reading; never changes the payment's status. */
  onReread: (paymentId: string) => Promise<RereadOutcome>
  /** The next and previous case in the queue — `null` when there is none. */
  onNext: (() => void) | null
  onPrev: (() => void) | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [rejectingFor, setRejectingFor] = useState<string | null>(null)
  const [reason, setReason] = useState<RejectionReason>('amount_mismatch')
  const [note, setNote] = useState('')
  /** Keyed by the payment it belongs to, so a new case never shows the last one's image. */
  const [loaded, setLoaded] = useState<{ id: string; state: ImageState } | null>(null)
  const [failed, setFailed] = useState(false)
  const [noticeFor, setNoticeFor] = useState<{ id: string; notice: CaseNotice } | null>(null)

  /**
   * Double-click guard, held by the payment it is sending for. The state
   * drives the disabled buttons; the ref is what actually stops a second
   * click landing before React re-rendered them. Per payment because a
   * decision moves the dialog on to the next case before its own request has
   * finished unwinding — a guard shared across cases swallowed the first key
   * pressed on the new one.
   */
  const [sendingFor, setSendingFor] = useState<string | null>(null)
  const inFlight = useRef<string | null>(null)

  /** The image at full size, over the dialog (I, or a click on it). */
  const [zoomed, setZoomed] = useState(false)
  /** The case's own shortcut legend (?). */
  const [legend, setLegend] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  /** A re-read asked for from here, until the queue comes back with it. */
  const [rereadAsked, setRereadAsked] = useState(false)
  const [rereadSending, setRereadSending] = useState(false)
  const [rereadError, setRereadError] = useState<'not_rereadable' | 'error' | null>(null)

  const paymentId = payment?.id ?? null
  const sending = paymentId !== null && sendingFor === paymentId
  // Held by the case they belong to, like `sendingFor`: on the render that
  // opens the next case they already read as clear, before any effect runs.
  const rejecting = paymentId !== null && rejectingFor === paymentId
  const notice = noticeFor && noticeFor.id === paymentId ? noticeFor.notice : null
  const setRejecting = (on: boolean) => setRejectingFor(on ? paymentId : null)
  const receiptReady = payment?.receipt === 'ready'
  const image: ImageState =
    loaded && loaded.id === paymentId ? loaded.state : { kind: 'loading' }

  // The form follows whichever payment the dialog was opened on, and is thrown
  // away on close — a half-written rejection must not leak into the next case.
  useEffect(() => {
    setRejectingFor(null)
    setReason(payment?.fraudSignals.includes('identical_file') ? 'duplicate' : 'amount_mismatch')
    setNote('')
    setFailed(false)
    setNoticeFor(null)
    setZoomed(false)
    setRereadAsked(false)
    setRereadError(null)
    // Only a new case resets the form; a re-render of the same one does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId])

  // Once the queue shows the request (or the worker already answered), the
  // queue's own state speaks for it.
  const rereadOnServer = payment?.rereadRequestedAt != null
  useEffect(() => {
    if (!rereadAsked) return
    if (rereadOnServer) {
      setRereadAsked(false)
      return
    }
    const timer = setTimeout(() => setRereadAsked(false), REREAD_ASKED_MS)
    return () => clearTimeout(timer)
  }, [rereadAsked, rereadOnServer])
  const rereadPending = rereadOnServer || rereadAsked

  // The signed URL is asked for once per opened case, and only when there is
  // an image to show. A late answer for a case already closed is dropped.
  useEffect(() => {
    if (!paymentId || !receiptReady) return
    let current = true
    void fetchReceiptUrl(paymentId).then((result) => {
      if (!current) return
      setLoaded({
        id: paymentId,
        state: result.ok ? { kind: 'shown', url: result.data.url } : { kind: 'unavailable' },
      })
    })
    return () => {
      current = false
    }
  }, [paymentId, receiptReady])

  async function send(decision: ReviewDecision) {
    if (!payment || inFlight.current === payment.id) return
    const id = payment.id
    inFlight.current = id
    setSendingFor(id)
    setFailed(false)
    try {
      const outcome = await onDecide(id, decision)
      if (outcome.kind === 'notice') setNoticeFor({ id, notice: outcome.notice })
      if (outcome.kind === 'error') setFailed(true)
    } finally {
      if (inFlight.current === id) inFlight.current = null
      setSendingFor((current) => (current === id ? null : current))
    }
  }

  /**
   * Decided elsewhere or gone: nothing left to decide here. A released seat
   * only blocks approving — rejecting is still how the case gets closed.
   */
  const closed = notice === 'already_settled' || notice === 'not_found'
  const approveBlocked = sending || notice !== null
  const rejectBlocked = sending || closed
  const rereadBlocked = !receiptReady || closed || rereadPending || rereadSending

  async function reread() {
    if (!payment || rereadBlocked) return
    setRereadSending(true)
    setRereadError(null)
    try {
      const outcome = await onReread(payment.id)
      if (outcome.kind === 'queued' || outcome.kind === 'in_progress') setRereadAsked(true)
      if (outcome.kind === 'notice') setNoticeFor({ id: payment.id, notice: outcome.notice })
      if (outcome.kind === 'not_rereadable' || outcome.kind === 'error') setRereadError(outcome.kind)
    } finally {
      setRereadSending(false)
    }
  }

  function rejectNow() {
    if (!rejectBlocked) void send({ kind: 'reject', reason, note: note.trim() })
  }

  /**
   * The case's keys. Rebuilt every render and read through a ref, so the one
   * listener below always sees the current case and form.
   */
  function onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat) return
    // The one shortcut that works from inside the note: confirming it.
    if (rejecting && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      rejectNow()
      return
    }
    if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const handled = (() => {
      switch (key) {
        case 'a':
          if (!rejecting && !approveBlocked) void send({ kind: 'approve' })
          return true
        case 'r':
          if (!rejectBlocked) setRejecting(true)
          return true
        case 'n':
          if (!rejecting) return false
          noteRef.current?.focus()
          return true
        case 'j':
        case 'ArrowRight':
          if (!sending) onNext?.()
          return true
        case 'k':
        case 'ArrowLeft':
          if (!sending) onPrev?.()
          return true
        case 'i':
          if (image.kind === 'shown') setZoomed((current) => !current)
          return true
        case 'l':
          void reread()
          return true
        case '?':
          setLegend((current) => !current)
          return true
        default: {
          const index = Number.parseInt(key, 10) - 1
          if (!rejecting || !(index >= 0 && index < REASONS.length)) return false
          if (!rejectBlocked) setReason(REASONS[index]!)
          return true
        }
      }
    })()
    if (handled) event.preventDefault()
  }
  const onKeyRef = useRef(onKey)
  useEffect(() => {
    onKeyRef.current = onKey
  })

  const open = payment !== null
  useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent) => onKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [open])

  const deadline = payment ? deadlineState(payment.reviewDeadline, renderedAt) : 'ok'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !inFlight.current) onClose()
      }}
    >
      <DialogContent
        closeLabel={t('receipt_review.close')}
        className="bg-white sm:max-w-xl"
        // Esc steps back one layer before it closes the case: the enlarged
        // image first, then the rejection form.
        onEscapeKeyDown={(event) => {
          if (zoomed) {
            event.preventDefault()
            setZoomed(false)
          } else if (rejecting && !sending) {
            event.preventDefault()
            setRejecting(false)
          }
        }}
      >
        {payment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {payment.studentName}
              </DialogTitle>
              <DialogDescription>
                {t('receipt_review.subtitle', {
                  date: formatDateTime(payment.submittedAt, locale),
                  course: `${payment.courseName} · ${payment.classGroupName}`,
                })}
              </DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={paymentTone[payment.status]}
                  label={t(`payment_status.${payment.status}`)}
                />
                <StatusBadge
                  tone={receiptStateTone[payment.receipt]}
                  label={t(`receipt_state.${payment.receipt}`)}
                />
                <span className="ml-auto flex items-center gap-1">
                  <CaseStepButton
                    icon="chevron-left"
                    label={t('receipt_review.prev_case')}
                    disabled={!onPrev || sending}
                    onClick={() => onPrev?.()}
                  />
                  <CaseStepButton
                    icon="chevron-right"
                    label={t('receipt_review.next_case')}
                    disabled={!onNext || sending}
                    onClick={() => onNext?.()}
                  />
                  <button
                    type="button"
                    onClick={() => setLegend((current) => !current)}
                    aria-expanded={legend}
                    aria-label={t('shortcuts.button')}
                    title={t('shortcuts.button')}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-line text-sm font-semibold text-muted-foreground transition hover:text-ink"
                  >
                    ?
                  </button>
                </span>
              </div>
            </DialogHeader>

            {legend && (
              <div className="border-b border-line bg-sky-soft px-5 py-4">
                <ShortcutList title={t('shortcuts.case_title')} shortcuts={CASE_SHORTCUTS} />
              </div>
            )}

            {zoomed && image.kind === 'shown' && (
              // The receipt at full size, over the case. Any click, I or Esc
              // puts it back.
              <button
                type="button"
                onClick={() => setZoomed(false)}
                aria-label={t('receipt_review.image_zoom_close')}
                className="fixed inset-0 z-[60] grid cursor-zoom-out place-items-center bg-ink/85 p-4"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={t('receipt_review.image_alt')}
                  className="max-h-full max-w-full rounded-lg bg-white object-contain"
                />
              </button>
            )}

            <div className="flex flex-col gap-6 p-5">
              <section>
                <SectionTitle icon="doc">{t('receipt_review.image_title')}</SectionTitle>
                {payment.receipt === 'missing' ? (
                  // No image at all: the only proof left is the bank statement,
                  // and the reviewer is told so before the approve button.
                  <ReceiptWarning text={t('receipt_review.no_receipt_warning')} />
                ) : payment.receipt === 'ready' && image.kind === 'shown' ? (
                  // A signed, five-minute URL straight from the bucket:
                  // `next/image` would proxy and cache a link that is meant to
                  // expire, so a plain <img> it is. The bucket origin is
                  // allowed in the CSP `img-src` (RECEIPT_IMAGE_ORIGIN).
                  <button
                    type="button"
                    onClick={() => setZoomed(true)}
                    aria-label={t('receipt_review.image_zoom')}
                    className="mt-3 block w-full cursor-zoom-in"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={t('receipt_review.image_alt')}
                      onError={() => setLoaded({ id: payment.id, state: { kind: 'unavailable' } })}
                      className="max-h-[28rem] w-full rounded-xl border border-line bg-sky-soft object-contain"
                    />
                  </button>
                ) : (
                  <ImagePlaceholder
                    busy={payment.receipt === 'ready' && image.kind === 'loading'}
                    text={
                      payment.receipt === 'ready'
                        ? image.kind === 'unavailable'
                          ? t('receipt_review.image_unavailable')
                          : null
                        : t(`receipt_state.${payment.receipt}`)
                    }
                  />
                )}
                {/* No usable image either way, so the same kind of warning as
                    a missing receipt — it warns, it never blocks approving
                    (a deposit on the bank statement is proof enough). Still
                    uploading also means the antifraud screening has not run:
                    its signals may arrive after the decision. */}
                {payment.receipt === 'refused' && (
                  <ReceiptWarning text={t('receipt_review.refused_receipt_warning')} />
                )}
                {payment.receipt === 'uploading' && (
                  <ReceiptWarning text={t('receipt_review.uploading_receipt_warning')} />
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('receipt_review.image_note')}
                </p>
              </section>

              {/* What the student said they paid with, against the price frozen
                  when the enrollment was opened. There is no discount: the
                  expected amount is the plan price, always (CLAUDE.md §1). */}
              <section>
                <SectionTitle icon="payments">{t('receipt_review.declared_title')}</SectionTitle>
                <dl className="mt-2">
                  <DataRow
                    label={t('payments.filter_method')}
                    value={formatPaymentMethod(
                      payment.method,
                      payment.methodDetail,
                      t('payment_method.other'),
                    )}
                  />
                  <DataRow
                    label={t('payments.col_operation')}
                    value={payment.operationNumber ?? t('payments.no_operation')}
                  />
                  <DataRow
                    label={t('receipt_review.check_expected')}
                    value={formatMoney(payment.expectedAmountCents, payment.currency, locale)}
                    strong
                  />
                  <DataRow
                    label={t('review.col_deadline')}
                    value={
                      deadline === 'overdue'
                        ? `${formatDateTime(payment.reviewDeadline, locale)} · ${t('review.deadline_overdue')}`
                        : formatDateTime(payment.reviewDeadline, locale)
                    }
                    danger={deadline !== 'ok'}
                  />
                </dl>
              </section>

              {payment.verdict && <VerdictNotice verdict={payment.verdict} />}
              {payment.reading && (
                <ReadingSection reading={payment.reading} source={payment.readingSource} />
              )}

              {/* A new reading of the same image (Sessão 32): when the first
                  one failed, came out shaky, or the reviewer can see it is
                  wrong. Queued, never waited on; the payment stays where it is. */}
              {payment.receipt === 'ready' && (
                <section className="-mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void reread()}
                      disabled={rereadBlocked}
                      aria-busy={rereadSending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <BoIcon name="refresh" size={14} />
                      {t('receipt_review.reread')}
                      <Kbd>L</Kbd>
                    </button>
                    {rereadPending && (
                      <span role="status" className="text-xs text-muted-foreground">
                        {t('receipt_review.reread_pending')}
                      </span>
                    )}
                  </div>
                  {rereadError && (
                    <p role="alert" className="text-xs font-semibold text-red-600">
                      {t(
                        rereadError === 'not_rereadable'
                          ? 'receipt_review.reread_not_rereadable'
                          : 'receipt_review.reread_error',
                      )}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{t('receipt_review.reread_note')}</p>
                </section>
              )}

              <section>
                <SectionTitle icon="shield">{t('receipt_review.signals_title')}</SectionTitle>
                {payment.fraudSignals.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('receipt_review.signals_none')}
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {payment.fraudSignals.map((signal) => (
                      <li
                        key={signal}
                        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                      >
                        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                        {t(`fraud_signal.${signal}`)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Decision */}
              <section className="border-t border-line pt-5">
                {rejecting ? (
                  <div className="flex flex-col gap-3">
                    <SectionTitle icon="close">{t('receipt_review.reject_title')}</SectionTitle>
                    <div className="flex flex-col gap-1.5">
                      {REASONS.map((value, index) => (
                        <label
                          key={value}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                            reason === value
                              ? 'border-brand-blue bg-sky text-ink'
                              : 'border-line text-muted-foreground hover:text-ink'
                          }`}
                        >
                          <input
                            type="radio"
                            name="rejection-reason"
                            value={value}
                            checked={reason === value}
                            onChange={() => setReason(value)}
                            disabled={rejectBlocked}
                            className="accent-brand-blue"
                          />
                          <span className="flex-1">{t(`rejection_reason.${value}`)}</span>
                          <Kbd>{String(index + 1)}</Kbd>
                        </label>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('receipt_review.reject_note_label')}
                      </span>
                      <textarea
                        ref={noteRef}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        maxLength={NOTE_MAX_LENGTH}
                        disabled={rejectBlocked}
                        placeholder={t('receipt_review.reject_note_placeholder')}
                        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={rejectBlocked}
                        aria-busy={sending}
                        onClick={rejectNow}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <BoIcon name="close" size={16} />
                        {t('receipt_review.reject_confirm')}
                        <span className="ml-1 hidden items-center gap-0.5 sm:inline-flex">
                          <Kbd>{KEY_CTRL}</Kbd>
                          <Kbd>{KEY_ENTER}</Kbd>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => setRejecting(false)}
                        className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t('receipt_review.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={approveBlocked}
                      aria-busy={sending}
                      onClick={() => void send({ kind: 'approve' })}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <BoIcon name="check" size={16} />
                      {t('receipt_review.approve')}
                      <span className="ml-1 hidden sm:inline-flex">
                        <Kbd>A</Kbd>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={rejectBlocked}
                      onClick={() => setRejecting(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <BoIcon name="close" size={16} />
                      {t('receipt_review.reject')}
                      <span className="ml-1 hidden sm:inline-flex">
                        <Kbd>R</Kbd>
                      </span>
                    </button>
                  </div>
                )}
                {notice && (
                  <p
                    role="status"
                    className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                    {t(`receipt_review.notice_${notice}`)}
                  </p>
                )}
                {failed && (
                  <p role="alert" className="mt-3 text-xs font-semibold text-red-600">
                    {t('receipt_review.decide_error')}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('receipt_review.audit_notice')}
                </p>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The receipt traffic light's verdict (OOC-21), in words. A suggested
 * rejection is only that — the reviewer still rejects, with a reason; a green
 * verdict only says amount, number and method match — the reviewer still
 * approves. Approvals are never automatic (owner, 03/10/2026).
 */
function VerdictNotice({ verdict }: { verdict: ReviewVerdict }) {
  const t = useTranslations('bo')
  const tone =
    verdict.verdict === 'reject_suggested'
      ? 'border-red-200 bg-red-50 text-red-800'
      : verdict.verdict === 'review'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'

  return (
    <section>
      <SectionTitle icon="shield">{t('receipt_review.verdict_title')}</SectionTitle>
      <p className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong className="font-semibold">{t(`receipt_review.verdict_${verdict.verdict}`)}</strong>
          {' · '}
          {t(`receipt_review.verdict_reason_${verdict.reason}`)}
        </span>
      </p>
    </section>
  )
}

/**
 * What OCR level 1 read off the receipt (OOC-20), field by field, with the
 * model's own confidence. The judgement on it is `VerdictNotice`, above; the
 * confidence threshold is still level 2's (Sessão 29), measured on real
 * receipts first (docs/OCR-AVALIACAO.md). The model id stays off screen — it is a technical id (CLAUDE.md §4) and lives
 * in the database for audit.
 */
function ReadingSection({
  reading,
  source,
}: {
  reading: ReceiptReading
  /** A re-read says so: the reviewer asked for it, and should see it came back. */
  source: PaymentReviewItem['readingSource']
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  if (reading.state === 'not_read') {
    return (
      <section>
        <SectionTitle icon="doc">{t('receipt_review.reading_title')}</SectionTitle>
        <p className="mt-2 text-sm text-muted-foreground">{t('receipt_review.reading_not_read')}</p>
      </section>
    )
  }

  if (reading.state === 'failed') {
    return (
      <section>
        <SectionTitle icon="doc">{t('receipt_review.reading_title')}</SectionTitle>
        <ReceiptWarning
          text={t('receipt_review.reading_failed', {
            reason: t(`receipt_review.reading_failure_${reading.reason}`),
          })}
        />
        {/* A failed re-read says it was one: the reviewer asked for it, and
            must not read it as the first reading still standing. */}
        {source === 'reread' && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('receipt_review.reading_reread_failed_at', {
              date: formatDateTime(reading.readAt, locale),
            })}
          </p>
        )}
      </section>
    )
  }

  const notFound = t('receipt_review.reading_not_found')
  const rows: { key: string; label: string; field: ReadField<unknown>; text: string }[] = [
    {
      key: 'amount',
      label: t('receipt_review.reading_field_amount'),
      field: reading.amountCents,
      text: reading.amountCents.value === null ? notFound : formatMoney(reading.amountCents.value, 'PEN', locale),
    },
    {
      key: 'operation',
      label: t('receipt_review.reading_field_operation'),
      field: reading.operationNumber,
      text: reading.operationNumber.value ?? notFound,
    },
    {
      key: 'method',
      label: t('receipt_review.reading_field_method'),
      field: reading.paymentMethod,
      text:
        reading.paymentMethod.value === null
          ? notFound
          : formatPaymentMethod(reading.paymentMethod.value, reading.paymentMethod.detail, t('payment_method.other')),
    },
    {
      key: 'payer',
      label: t('receipt_review.reading_field_payer'),
      field: reading.payerName,
      text: reading.payerName.value ?? notFound,
    },
    {
      key: 'paid_at',
      label: t('receipt_review.reading_field_paid_at'),
      field: reading.paidAt,
      text:
        reading.paidAt.value === null
          ? notFound
          : reading.paidAt.value.length === 10
            ? formatDate(reading.paidAt.value, locale)
            : formatDateTime(reading.paidAt.value, locale),
    },
  ]

  return (
    <section>
      <SectionTitle icon="doc">{t('receipt_review.reading_title')}</SectionTitle>
      <p className="mt-2 text-xs text-muted-foreground">{t('receipt_review.reading_intro')}</p>
      <dl className="mt-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0"
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
            <dd className="text-right">
              <span
                className={`block text-sm tabular-nums ${
                  row.field.value === null ? 'text-muted-foreground' : 'font-medium text-ink'
                }`}
              >
                {row.text}
              </span>
              {row.field.value !== null && (
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {t('receipt_review.reading_confidence', { value: Math.round(row.field.confidence * 100) })}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(source === 'reread' ? 'receipt_review.reading_reread_at' : 'receipt_review.reading_read_at', {
          date: formatDateTime(reading.readAt, locale),
        })}
      </p>
    </section>
  )
}

/** Previous / next case, for the mouse; J and K do the same. */
function CaseStepButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: 'chevron-left' | 'chevron-right'
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      <BoIcon name={icon} size={16} />
    </button>
  )
}

/** An amber note on the receipt the reviewer is about to decide without. */
function ReceiptWarning({ text }: { text: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
      {text}
    </p>
  )
}

/** Where the image would be: still loading, or a word on why it is not here. */
function ImagePlaceholder({ busy, text }: { busy: boolean; text: string | null }) {
  return (
    <div
      aria-busy={busy}
      className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-sky-soft px-6 py-10 text-center"
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-full bg-white text-brand-blue shadow-card ${
          busy ? 'animate-pulse' : ''
        }`}
      >
        <BoIcon name="doc" size={20} />
      </span>
      {text && <p className="max-w-xs text-xs text-muted-foreground">{text}</p>}
    </div>
  )
}

function DataRow({
  label,
  value,
  strong = false,
  danger = false,
}: {
  label: string
  value: string
  strong?: boolean
  danger?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`text-right text-sm tabular-nums ${
          danger ? 'font-semibold text-red-600' : strong ? 'font-semibold text-ink' : 'font-medium text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
