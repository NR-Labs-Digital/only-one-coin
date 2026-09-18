'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ExtractedValue,
  ReceiptExtraction,
  RejectionReason,
  ReviewDecision,
} from '@/lib/backoffice/types'
import { formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { reviewFlagTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Offered in the order the queue produces them — the first four mirror a flag. */
const REASONS: RejectionReason[] = [
  'amount_mismatch',
  'illegible',
  'duplicate',
  'not_a_receipt',
  'other',
]

/**
 * Where a receipt is actually settled: the image on one side, what the model
 * read on the other, and the frozen price it is checked against. This is the
 * one place a payment changes state — the student file stays read-only, because
 * approving is a usecase with its own audit entry, not a click on a profile
 * (CLAUDE.md §8).
 *
 * The reviewer is never asked to trust a single number: every field carries its
 * own confidence, the tier says how the extraction got here, and when the
 * ladder escalated, both readings are shown side by side. Agreement decides,
 * not the more expensive model (CLAUDE.md §5).
 *
 * A centred modal, the same shape the ledger opens a payment with: the queue
 * stays behind it, and the case gets the middle of the screen instead of a
 * strip glued to the edge.
 */
export function ReceiptReviewDialog({
  extraction,
  onClose,
  onDecide,
}: {
  extraction: ReceiptExtraction | null
  onClose: () => void
  onDecide: (paymentId: string, decision: ReviewDecision) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState<RejectionReason>('amount_mismatch')
  const [note, setNote] = useState('')

  // The form follows whichever receipt the dialog was opened on, and is thrown
  // away on close — a half-written rejection must not leak into the next case.
  useEffect(() => {
    setRejecting(false)
    setReason(extraction?.flag === 'duplicate_phash' ? 'duplicate' : 'amount_mismatch')
    setNote('')
  }, [extraction])

  function value(field: ExtractedValue): string {
    switch (field.kind) {
      case 'text':
        return field.text
      case 'money':
        return formatMoney(field.amountCents, field.currency, locale)
      case 'timestamp':
        return formatDateTime(field.iso, locale)
      case 'method':
        return formatPaymentMethod(field.method, null, t('payment_method.other'))
      case 'unreadable':
        return t('receipt_review.unreadable')
    }
  }

  return (
    <Dialog
      open={extraction !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        closeLabel={t('receipt_review.close')}
        className="bg-white sm:max-w-xl"
      >
        {extraction && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {extraction.studentName}
              </DialogTitle>
              <DialogDescription>
                {t('receipt_review.subtitle', {
                  date: formatDateTime(extraction.submittedAt, locale),
                  course:
                    extraction.concept.kind === 'course'
                      ? extraction.concept.courseName
                      : t(`document_type.${extraction.concept.type}`),
                })}
              </DialogDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={reviewFlagTone[extraction.flag]}
                  label={t(`review_flag.${extraction.flag}`)}
                />
                <span className="text-xs text-muted-foreground">
                  {t('receipt_review.extraction_source', {
                    tier: extraction.tier,
                    model: extraction.modelName,
                    version: extraction.modelVersion,
                  })}
                </span>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-6 p-5">
              {/* Tier 0 is a block, not a doubt: the reviewer is confirming a
                  match, not reading a number. It goes first. */}
              {extraction.duplicateOf && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                    <BoIcon name="alert" size={15} />
                    {t('receipt_review.duplicate_title')}
                  </p>
                  <p className="mt-1 text-xs text-red-700/90">
                    {t('receipt_review.duplicate_body', {
                      name: extraction.duplicateOf.studentName,
                      date: formatDate(extraction.duplicateOf.approvedAt, locale),
                    })}
                  </p>
                </div>
              )}

              <section>
                <SectionTitle icon="doc">
                  {t('receipt_review.image_title')}
                </SectionTitle>
                {/* No storage is wired yet; in production this is a signed URL
                    of 5 minutes, scoped to the student (CLAUDE.md §8). */}
                <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-sky-soft px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-brand-blue shadow-card">
                    <BoIcon name="doc" size={20} />
                  </span>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {t('receipt_review.image_placeholder')}
                  </p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('receipt_review.image_note')}
                </p>
              </section>

              <section>
                <SectionTitle icon="shield">
                  {t('receipt_review.extraction_title')}
                </SectionTitle>
                <dl className="mt-2">
                  {extraction.fields.map((field) => (
                    <FieldRow
                      key={field.field}
                      label={t(`extraction_field.${field.field}`)}
                      value={value(field.value)}
                      unreadable={field.value.kind === 'unreadable'}
                      confidence={field.confidence}
                      confidenceLabel={t('receipt_review.field_confidence', {
                        value: Math.round(field.confidence * 100),
                      })}
                    />
                  ))}
                </dl>
              </section>

              {/* What the receipt says against what the plan costs. The
                  difference is the whole reason the case is open, so it is a
                  line of its own and not a subtraction left to the reader. */}
              <section>
                <SectionTitle icon="payments">
                  {t('receipt_review.check_title')}
                </SectionTitle>
                <div className="mt-3 rounded-lg border border-line">
                  <AmountRow
                    label={t('receipt_review.check_read')}
                    amount={formatMoney(extraction.amountCents, 'PEN', locale)}
                    strong
                  />
                  <AmountRow
                    label={t('receipt_review.check_expected')}
                    amount={formatMoney(extraction.expectedAmountCents, 'PEN', locale)}
                  />
                  {extraction.amountCents !== extraction.expectedAmountCents && (
                    <p className="border-t border-line px-3 py-2 text-xs font-semibold text-red-600">
                      {t('receipt_review.check_difference', {
                        amount: formatMoney(
                          Math.abs(extraction.amountCents - extraction.expectedAmountCents),
                          'PEN',
                          locale,
                        ),
                      })}
                    </p>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('receipt_review.check_tolerance', {
                    amount: formatMoney(extraction.toleranceCents, 'PEN', locale),
                  })}
                </p>
              </section>

              {extraction.secondOpinion && (
                <section>
                  <SectionTitle icon="trend-up">
                    {t('receipt_review.second_opinion_title')}
                  </SectionTitle>
                  <div className="mt-3 rounded-lg border border-line">
                    <AmountRow
                      label={t('receipt_review.second_opinion_operation')}
                      amount={
                        extraction.secondOpinion.operationNumber ??
                        t('receipt_review.unreadable')
                      }
                    />
                    <AmountRow
                      label={t('receipt_review.second_opinion_amount')}
                      amount={formatMoney(
                        extraction.secondOpinion.amountCents,
                        'PEN',
                        locale,
                      )}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('receipt_review.second_opinion_note')}
                  </p>
                </section>
              )}

              {/* Decision */}
              <section className="border-t border-line pt-5">
                {rejecting ? (
                  <div className="flex flex-col gap-3">
                    <SectionTitle icon="close">
                      {t('receipt_review.reject_title')}
                    </SectionTitle>
                    <div className="flex flex-col gap-1.5">
                      {REASONS.map((value) => (
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
                            className="accent-brand-blue"
                          />
                          {t(`rejection_reason.${value}`)}
                        </label>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('receipt_review.reject_note_label')}
                      </span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        placeholder={t('receipt_review.reject_note_placeholder')}
                        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onDecide(extraction.paymentId, {
                            kind: 'reject',
                            reason,
                            note,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
                      >
                        <BoIcon name="close" size={16} />
                        {t('receipt_review.reject_confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(false)}
                        className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                      >
                        {t('receipt_review.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {extraction.duplicateOf && (
                      <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                        {t('receipt_review.duplicate_warning')}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onDecide(extraction.paymentId, { kind: 'approve' })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep"
                      >
                        <BoIcon name="check" size={16} />
                        {t('receipt_review.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:border-red-200 hover:text-red-600"
                      >
                        <BoIcon name="close" size={16} />
                        {t('receipt_review.reject')}
                      </button>
                    </div>
                  </div>
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
 * One extracted field. The confidence is coloured, not just printed: a reviewer
 * scanning five fields needs to land on the weak one without reading numbers.
 */
function FieldRow({
  label,
  value,
  unreadable,
  confidence,
  confidenceLabel,
}: {
  label: string
  value: string
  unreadable: boolean
  confidence: number
  confidenceLabel: string
}) {
  const tone =
    confidence < 0.6
      ? 'text-red-600'
      : confidence < 0.8
        ? 'text-amber-600'
        : 'text-emerald-600'
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right">
        <span
          className={`block text-sm font-medium tabular-nums ${
            unreadable ? 'italic text-muted-foreground' : 'text-ink'
          }`}
        >
          {value}
        </span>
        <span className={`block text-xs tabular-nums ${tone}`}>{confidenceLabel}</span>
      </dd>
    </div>
  )
}

function AmountRow({
  label,
  amount,
  strong = false,
}: {
  label: string
  amount: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-3 py-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${
          strong ? 'text-sm font-semibold text-ink' : 'text-sm text-ink'
        }`}
      >
        {amount}
      </span>
    </div>
  )
}
