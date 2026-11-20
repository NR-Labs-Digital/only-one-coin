'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@/lib/format'
import { parseFieldErrors } from '@/lib/field-errors'
import type {
  CheckoutDraft,
  PublicCatalog,
  StepId,
} from '@/lib/enrollment/types'
import { clearCheckoutStorage, useCheckout } from '@/lib/enrollment/use-checkout'
import {
  checkoutItems,
  MAX_LOT_ITEMS,
  personKey,
  phoneNumberOf,
  planOfCourse,
  type CheckoutItem,
} from '@/lib/enrollment/checkout'
import { Stepper } from '@/components/enrollment/stepper'
import { HoldTimer } from '@/components/enrollment/hold-timer'
import { CheckoutIcon } from '@/components/enrollment/icons'
import { StepCourse } from './step-course'
import { StepStudent } from './step-student'
import { StepPayment } from './step-payment'
import { StepReview, type SubmitOutcome } from './step-review'
import { Submitted } from './submitted'
import { Expired } from './expired'
import { LotPanel } from './lot-panel'

// A resend that finds the first attempt still running (409
// `idempotency.in_progress`, OOC-24) waits this long and tries again — the
// first one either lands, and the resend gets its answer, or fails and frees
// the key.
const IN_PROGRESS_RETRY_MS = 1500
const IN_PROGRESS_MAX_RETRIES = 5

// Short route code -> the full locale name the API (and the e-mails it
// sends) speaks — the same mapping as `src/i18n/request.ts`.
const apiLocale: Record<Locale, 'es-PE' | 'en' | 'pt-BR'> = {
  es: 'es-PE',
  en: 'en',
  pt: 'pt-BR',
}

/**
 * The public checkout — one wizard, two ways in.
 *
 * Somebody arriving from the landing picks a course; somebody arriving on the
 * seller's link (`?course=…&group=…&src=whatsapp`) finds step 1 already
 * answered and starts at step 2. It is deliberately not two screens: that would
 * be the enrollment form maintained twice, diverging at the first new field,
 * and the channel metric it would buy is bought instead by one attribution
 * field (`docs/MATRICULA-CHECKOUT.md` §1).
 *
 * The seat hold and the submit are both `apps/api` calls; every write is a
 * usecase in `packages/domain` behind it, never the browser (`CLAUDE.md` §8).
 */
export function Checkout({
  catalog,
  initialDraft,
}: {
  catalog: PublicCatalog
  initialDraft: CheckoutDraft
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale
  const [reference, setReference] = useState<string | null>(null)

  // Minted once per visit to this component and resent unchanged on every
  // retry (CLAUDE.md §5, "duplo POST de celular ruim é certeza") — a fresh
  // key per attempt would defeat the point.
  const idempotencyKey = useRef(crypto.randomUUID())

  const {
    draft,
    setDraft,
    step,
    goTo,
    holdSecondsLeft,
    holdExpired,
    holdId,
    holding,
    holdError,
    startHold,
    settleHold,
    expireHold,
    restart,
    receiptHoldId,
    addAnotherCourse,
    cancelAnotherCourse,
    removeLotEntry,
  } = useCheckout(catalog, initialDraft)

  const stepLabels: Record<StepId, string> = {
    course: t('step.course.short'),
    student: t('step.student.short'),
    payment: t('step.payment.short'),
    review: t('step.review.short'),
  }

  async function leaveCourseStep() {
    // The seat is taken the moment the class group is settled — before the
    // money, on purpose. The reader is about to be sent to their banking app,
    // and coming back to a full class group has no remedy in a business with
    // no refund flow (`docs/MATRICULA-CHECKOUT.md` §3).
    if (!draft.course.classGroupId) return
    const outcome = await startHold(draft.course.classGroupId)
    // No seat, no step 2: the reason is on screen and the reader picks again.
    if (outcome === 'held') goTo('student')
  }

  /** Several courses, one receipt (OOC-158): this course joins the lot and
   * the next one starts at step 1. */
  function addCourse() {
    if (addAnotherCourse()) goTo('course')
  }

  async function submit(captchaToken: string): Promise<SubmitOutcome> {
    const items = checkoutItems(draft)
    const holds = [...draft.lot.map((entry) => entry.hold.id), holdId]
    const plans = items.map((item) => planOfCourse(catalog, item.course.courseId, item.course.planId))
    const receiptUploadId = draft.payment.receipt?.receiptUploadId ?? null
    if (
      !draft.payment.method ||
      !receiptUploadId ||
      holds.some((id) => !id) ||
      plans.some((plan) => !plan) ||
      items.some((item) => !item.course.classGroupId)
    ) {
      throw new Error('Checkout draft is missing a required field at submit')
    }

    // One entry per person (one document, one person — CLAUDE.md §1), each
    // item pointing at theirs by index.
    const people: CheckoutItem[] = []
    const personIndex = new Map<string, number>()
    for (const item of items) {
      const key = personKey(item.student)
      if (!personIndex.has(key)) {
        personIndex.set(key, people.length)
        people.push(item)
      }
    }

    const payload = JSON.stringify({
      // Turnstile (OOC-24): checked by the API before anything is written.
      captchaToken,
      // Minted and confirmed in step 3 (RequestReceiptUploadRoute,
      // ConfirmReceiptUploadRoute) against the first item's hold — the server
      // checks it belongs to that hold and actually landed in the bucket.
      receiptUploadId,
      people: people.map(({ student, guardian }) => ({
        student: {
          firstName: student.firstName,
          lastName: student.lastName,
          nationalIdType: student.nationalIdType,
          nationalId: student.nationalId,
          email: student.email,
          phone: phoneNumberOf(student.phone),
          birthDate: student.birthDate,
          // Peru only — the public form has no country selector
          // (StudentDraft doc comment, lib/enrollment/types.ts).
          country: 'PE',
          region: student.region,
          city: student.city,
        },
        guardian: guardian.consentAccepted
          ? {
              firstName: guardian.firstName,
              lastName: guardian.lastName,
              relationship: guardian.relationship,
              nationalIdType: guardian.nationalIdType,
              nationalId: guardian.nationalId,
              email: guardian.email,
              phone: phoneNumberOf(guardian.phone),
              consentAccepted: true as const,
            }
          : null,
      })),
      // The seat and the channel travel as each hold's id: the server reads
      // both off the hold, never off this body.
      items: items.map((item, index) => ({
        holdId: holds[index],
        classGroupId: item.course.classGroupId,
        planId: plans[index]!.id,
        person: personIndex.get(personKey(item.student)),
      })),
      // The e-mails about this enrollment are written in this language.
      locale: apiLocale[locale],
      payment: {
        method: draft.payment.method,
        methodDetail: null,
        operationNumber: draft.payment.operationNumber,
        idempotencyKey: idempotencyKey.current,
      },
    })

    const post = () =>
      fetch('/api/v1/enrollments/public/lot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

    let response = await post()
    for (let retry = 0; response.status === 409 && retry < IN_PROGRESS_MAX_RETRIES; retry++) {
      await new Promise((resolve) => setTimeout(resolve, IN_PROGRESS_RETRY_MS))
      response = await post()
    }

    if (!response.ok) {
      // Too many attempts from here (OOC-24). Nothing was written; the hold
      // keeps running, so waiting a few minutes and sending again works.
      if (response.status === 429) return 'rate_limited'
      // A field the API refused (OOC-64). Same rules as this page, so this is
      // a stale bundle or a server-only check; nothing was written and the
      // hold is intact.
      if (response.status === 400) {
        const fields = parseFieldErrors(await response.json().catch(() => null))
        if (fields.length > 0) return { kind: 'invalid_fields', fields }
      }
      if (response.status === 422) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        // The server says the hold is gone — expired, or swept, while the
        // reader was still typing. Same ending as the countdown reaching zero:
        // the seat may already be somebody else's, and the attempt starts over.
        if (body?.reason === 'enrollment.seat_hold_expired') {
          expireHold()
          return 'sent'
        }
        // Another enrollment already paid with this operation number (OOC-22).
        // Nothing was written and the hold is intact: the reader fixes a typo,
        // or it was not their receipt to send.
        if (body?.reason === 'enrollment.operation_number_already_used') {
          return 'operation_number_used'
        }
        // The captcha token was refused (expired, already used). Nothing was
        // written; the widget hands out a new one.
        if (body?.reason === 'captcha.failed') {
          return 'captcha_failed'
        }
      }
      throw new Error(`Submit failed: ${response.status}`)
    }

    // Proof is in: the short clock stops and the five-day review window takes
    // over. The seat stays `reserved` — it becomes `confirmed` only when the
    // payment is approved (`CLAUDE.md` §5).
    settleHold()
    setReference(referenceFrom(draft))
    clearCheckoutStorage()
    window.scrollTo({ top: 0 })
    return 'sent'
  }

  if (reference) {
    return (
      <Shell>
        <Submitted
          catalog={catalog}
          draft={draft}
          reference={reference}
          onRestart={() => {
            setReference(null)
            restart()
          }}
        />
      </Shell>
    )
  }

  // Terminal, and checked before the stepper: a rail showing "step 2 of 4" over
  // a checkout that no longer holds a seat is the screen lying about itself.
  if (holdExpired) {
    return (
      <Shell>
        <Expired onRestart={restart} />
      </Shell>
    )
  }

  return (
    <Shell>
      <Stepper
        current={step}
        labels={stepLabels}
        positionLabel={t('step.position', {
          current: ['course', 'student', 'payment', 'review'].indexOf(step) + 1,
          total: 4,
        })}
      />

      {/* Past zero the reservation still counts (OOC-155): the server seats
          it on submit, so the form stays and says so instead of a timer stuck
          at 0:00. */}
      {holdSecondsLeft === 0 && (
        <p
          role="status"
          className="mb-5 flex items-start gap-2 rounded-xl border border-brand-yellow-deep/25 bg-brand-yellow/10 px-3.5 py-2.5 text-sm font-medium text-ink"
        >
          <CheckoutIcon name="clock" size={16} className="mt-0.5 shrink-0" />
          {t('hold.ran_out')}
        </p>
      )}

      {holdSecondsLeft !== null && holdSecondsLeft > 0 && (
        <div className="mb-5">
          <HoldTimer
            secondsLeft={holdSecondsLeft}
            label={t('hold.active')}
            timeLabel={t('hold.remaining', {
              minutes: Math.floor(holdSecondsLeft / 60),
              seconds: holdSecondsLeft % 60,
            })}
          />
        </div>
      )}

      {step !== 'review' && (
        <LotPanel
          catalog={catalog}
          draft={draft}
          onRemove={removeLotEntry}
          // Stepping back from a course being added — only before its seat.
          onCancelAdd={step === 'course' ? () => {
            cancelAnotherCourse()
            goTo('student')
          } : undefined}
        />
      )}

      {step === 'course' && (
        <StepCourse
          catalog={catalog}
          draft={draft}
          setDraft={setDraft}
          holding={holding}
          holdError={holdError}
          onContinue={() => void leaveCourseStep()}
        />
      )}

      {step === 'student' && (
        <StepStudent
          catalog={catalog}
          draft={draft}
          setDraft={setDraft}
          onBack={() => goTo('course')}
          onContinue={() => goTo('payment')}
          onAddCourse={draft.lot.length + 1 < MAX_LOT_ITEMS ? addCourse : undefined}
        />
      )}

      {step === 'payment' && (
        <StepPayment
          catalog={catalog}
          draft={draft}
          setDraft={setDraft}
          holdId={receiptHoldId}
          onBack={() => goTo('student')}
          onContinue={() => goTo('review')}
        />
      )}

      {step === 'review' && (
        <StepReview
          catalog={catalog}
          draft={draft}
          onEdit={goTo}
          onBack={() => goTo('payment')}
          onSubmit={submit}
          onRemoveLotEntry={removeLotEntry}
        />
      )}
    </Shell>
  )
}

/**
 * `@container/checkout` names the reading column so the stepper can collapse on
 * the space it actually got rather than on the window width (`CLAUDE.md` §5,
 * "Layout das telas").
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container/checkout mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  )
}

/**
 * The tracking code the reader is told to quote. Same shape the backoffice
 * enrollment ledger shows and searches on (`listEnrollments`) — a code the
 * student can read out that nobody here can look up is worse than no code.
 *
 * Built in the browser only for the mockup: the real one is issued by
 * `apps/api` at submit and stored on the row. It is a readable reference, never
 * a row id (`CLAUDE.md` §4).
 */
function referenceFrom(draft: CheckoutDraft): string {
  const digits = draft.student.nationalId.replace(/\D/g, '').slice(-4).padStart(4, '0')
  return `OOC-${new Date().getFullYear()}-${digits}`
}
