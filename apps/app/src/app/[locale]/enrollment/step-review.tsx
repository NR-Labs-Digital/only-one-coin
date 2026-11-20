'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FieldError } from '@ooc/domain/fields'
import type { CheckoutDraft, PublicCatalog, StepId } from '@/lib/enrollment/types'
import {
  checkoutItems,
  checkoutTotalCents,
  courseById,
  groupById,
  personKey,
  planOfCourse,
  type CheckoutItem,
} from '@/lib/enrollment/checkout'
import { scheduleLines } from '@/lib/enrollment/schedule'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import { paymentMethodLabel } from '@/lib/payment-method'
import {
  Card,
  GhostButton,
  Note,
  PrimaryButton,
  StepNav,
  StepHeading,
  SummaryRow,
} from '@/components/enrollment/ui'
import { CheckoutIcon } from '@/components/enrollment/icons'
import { Turnstile } from '@/components/enrollment/turnstile'
import { env } from '@/env'

/** How a submit that did not throw ended. A refused operation number, or a
 * field the API refused, is not a failure to retry — sending the same thing
 * again gets the same answer. A refused captcha or a rate limit is: after a
 * new captcha, or after a wait. */
export type SubmitOutcome =
  | 'sent'
  | 'operation_number_used'
  | 'captcha_failed'
  | 'rate_limited'
  | { kind: 'invalid_fields'; fields: FieldError[] }

type SubmitError = Exclude<SubmitOutcome, 'sent'> | 'failed'

/**
 * Field paths the API can name, mapped to the label the reader saw. The rules
 * are the same copy on both sides (`@ooc/domain/fields`), so landing here
 * means a stale page or a rule that only the server can check — rare, but the
 * reader still deserves to know which box to fix.
 */
const FIELD_LABELS: Record<string, string> = {
  firstName: 'field.first_name',
  lastName: 'field.last_name',
  nationalId: 'field.national_id',
  phone: 'field.phone',
  email: 'field.email',
  birthDate: 'field.birth_date',
  region: 'field.region',
  city: 'field.city',
  operationNumber: 'field.operation_number',
}

/**
 * Step 4 — everything in one place, then send.
 *
 * The point of the screen is the edit links, not the list. A person who has to
 * go back and fix a mistyped document number should not have to walk forward
 * through three steps to get back here.
 *
 * What the submit does in production (Sessão 24 of the roadmap): one short
 * transaction writing student + enrollment + payment `pending`, the atomic seat
 * increment, an idempotency key, then a queued job — and a reply under 300ms.
 * The route does not import the AI module (`CLAUDE.md` §5). Here it just moves
 * to the success screen.
 */
export function StepReview({
  catalog,
  draft,
  onEdit,
  onBack,
  onSubmit,
  onRemoveLotEntry,
}: {
  catalog: PublicCatalog
  draft: CheckoutDraft
  onEdit: (step: StepId) => void
  onBack: () => void
  onSubmit: (captchaToken: string) => Promise<SubmitOutcome>
  /** Takes a settled course out of the lot (OOC-158). */
  onRemoveLotEntry: (index: number) => void
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState<SubmitError | null>(null)
  // Turnstile (OOC-24): one token per submit. Bumping the reset key after an
  // attempt makes the widget issue the next one.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false)

  const course = courseById(catalog, draft.course.courseId)
  const group = groupById(catalog, draft.course.classGroupId)
  const plan = planOfCourse(catalog, draft.course.courseId, draft.course.planId)
  const minorFlow = draft.guardian.consentAccepted
  // Several courses, one receipt (OOC-158).
  const items = checkoutItems(draft)
  const isLot = items.length > 1
  const totalCents = checkoutTotalCents(catalog, draft)

  async function send() {
    // Guards the double POST from a bad phone connection on the screen side;
    // the guarantee is the idempotency key on the payment (`CLAUDE.md` §5).
    if (sending || !captchaToken) return
    setSending(true)
    setSubmitError(null)
    try {
      const outcome = await onSubmit(captchaToken)
      // Refused before anything was written: the reader corrects the value
      // through the edit links, or waits, and sends again.
      if (outcome !== 'sent') {
        setSending(false)
        setSubmitError(outcome)
        setCaptchaResetKey((key) => key + 1)
      }
    } catch {
      // Retriable: the idempotency key is stable across attempts, so a
      // second click is safe rather than a second seat.
      setSending(false)
      setSubmitError('failed')
      setCaptchaResetKey((key) => key + 1)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <StepHeading
        title={t('step.review.title')}
        subtitle={t('step.review.subtitle')}
      />

      {isLot && (
        <LotReview catalog={catalog} items={items} onEdit={onEdit} onRemove={onRemoveLotEntry} />
      )}

      {!isLot && (
        <Card className="p-5">
          <SectionHead
            title={t('step.review.course_section')}
            onEdit={() => onEdit('course')}
            editLabel={t('action.edit')}
          />
          <dl className="divide-y divide-line">
            {course && <SummaryRow label={t('summary.course')}>{course.name}</SummaryRow>}
            {plan && <SummaryRow label={t('summary.plan')}>{plan.name}</SummaryRow>}
            {group && (
              <>
                <SummaryRow label={t('summary.schedule')}>
                  {scheduleLines(
                    group,
                    (day) => t(`weekday.${day}`),
                    (vars) => t('time_range', vars),
                  ).map((line) => (
                    <span key={line.key} className="block">{`${line.day} — ${line.time}`}</span>
                  ))}
                </SummaryRow>
                <SummaryRow label={t('summary.starts_on')}>
                  {formatDate(group.startDate, locale)}
                </SummaryRow>
              </>
            )}
          </dl>
        </Card>
      )}

      {!isLot && (
        <Card className="p-5">
          <SectionHead
            title={t('step.review.student_section')}
            onEdit={() => onEdit('student')}
            editLabel={t('action.edit')}
          />
          <dl className="divide-y divide-line">
            <SummaryRow label={t('summary.full_name')}>
              {`${draft.student.firstName} ${draft.student.lastName}`}
            </SummaryRow>
            <SummaryRow label={t('summary.document')}>
              {`${t(`national_id_type.${draft.student.nationalIdType}`)} ${draft.student.nationalId}`}
            </SummaryRow>
            <SummaryRow label={t('summary.phone')}>{draft.student.phone}</SummaryRow>
            <SummaryRow label={t('summary.email')}>{draft.student.email}</SummaryRow>
            <SummaryRow label={t('summary.birth_date')}>
              {draft.student.birthDate
                ? formatDate(draft.student.birthDate, locale)
                : ''}
            </SummaryRow>
          </dl>

          {minorFlow && (
            <>
              <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('step.review.guardian_section')}
              </p>
              <dl className="divide-y divide-line">
                <SummaryRow label={t('summary.full_name')}>
                  {`${draft.guardian.firstName} ${draft.guardian.lastName}`}
                </SummaryRow>
                <SummaryRow label={t('field.relationship')}>
                  {t(`relationship.${draft.guardian.relationship}`)}
                </SummaryRow>
                <SummaryRow label={t('summary.document')}>
                  {`${t(`national_id_type.${draft.guardian.nationalIdType}`)} ${draft.guardian.nationalId}`}
                </SummaryRow>
                <SummaryRow label={t('summary.phone')}>
                  {draft.guardian.phone}
                </SummaryRow>
                <SummaryRow label={t('summary.email')}>
                  {draft.guardian.email}
                </SummaryRow>
                <SummaryRow label={t('summary.consent')}>
                  {t('step.review.consent_given', {
                    version: catalog.settings.consentVersion,
                  })}
                </SummaryRow>
              </dl>
            </>
          )}
        </Card>
      )}

      <Card className="p-5">
        <SectionHead
          title={t('step.review.payment_section')}
          onEdit={() => onEdit('payment')}
          editLabel={t('action.edit')}
        />
        <dl className="divide-y divide-line">
          {draft.payment.method && (
            <SummaryRow label={t('summary.method')}>
              {paymentMethodLabel[draft.payment.method]}
            </SummaryRow>
          )}
          <SummaryRow label={t('summary.operation_number')}>
            <span className="font-mono text-xs">{draft.payment.operationNumber}</span>
          </SummaryRow>
          {draft.payment.receipt && (
            <SummaryRow label={t('summary.receipt')}>
              <span className="inline-flex items-center gap-1.5">
                <CheckoutIcon name="file" size={14} />
                <span className="truncate">{draft.payment.receipt.fileName}</span>
              </span>
            </SummaryRow>
          )}
          {plan && (
            <SummaryRow label={t('summary.total')} strong>
              {formatMoney(totalCents, plan.currency, locale)}
            </SummaryRow>
          )}
        </dl>
      </Card>

      {/* Says out loud what sending does and does not do. Nobody should leave
          this screen thinking the seat is theirs — the payment still has to
          clear review (`CLAUDE.md` §5). */}
      <Note tone="info">
        {t(isLot ? 'lot.what_happens' : 'step.review.what_happens', { days: catalog.settings.reservationDays })}
      </Note>

      <div className="flex flex-col gap-2">
        <Turnstile
          siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          locale={locale}
          resetKey={captchaResetKey}
          onToken={setCaptchaToken}
          onUnavailable={() => setCaptchaUnavailable(true)}
        />
        {captchaUnavailable ? (
          <Note tone="danger">{t('step.review.captcha_unavailable')}</Note>
        ) : (
          !captchaToken && <p className="text-xs text-muted-foreground">{t('step.review.captcha_hint')}</p>
        )}
      </div>

      {submitError === 'failed' && <Note tone="danger">{t('step.review.submit_failed')}</Note>}
      {submitError === 'captcha_failed' && <Note tone="danger">{t('step.review.captcha_failed')}</Note>}
      {submitError === 'rate_limited' && <Note tone="danger">{t('step.review.rate_limited')}</Note>}
      {submitError === 'operation_number_used' && (
        <Note tone="danger">{t('step.review.operation_number_used')}</Note>
      )}
      {typeof submitError === 'object' && submitError !== null && (
        <Note tone="danger">
          {t('step.review.invalid_fields')}
          <ul className="mt-1.5 list-disc pl-5">
            {submitError.fields.map((field) => {
              // A lot names the person first (`people.1.student.email`).
              const [scope, name = ''] = field.path.replace(/^people\.\d+\./, '').split('.')
              const labelKey = FIELD_LABELS[name]
              const label = labelKey ? t(labelKey) : t('step.review.other_field')
              return (
                <li key={field.path}>
                  {scope === 'guardian'
                    ? t('step.review.guardian_field', { field: label })
                    : label}
                  {': '}
                  {t(`error.${field.code}`)}
                </li>
              )
            })}
          </ul>
        </Note>
      )}

      <StepNav
        back={
          <GhostButton onClick={onBack}>
            <CheckoutIcon name="arrow-left" size={16} />
            {t('action.back')}
          </GhostButton>
        }
      >
        <PrimaryButton onClick={() => void send()} disabled={sending || !captchaToken}>
          <CheckoutIcon name="check" size={16} />
          {t('action.submit')}
        </PrimaryButton>
      </StepNav>
    </div>
  )
}

function SectionHead({
  title,
  onEdit,
  editLabel,
}: {
  title: string
  onEdit: () => void
  editLabel: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
      >
        {editLabel}
      </button>
    </div>
  )
}

/**
 * A lot (OOC-158), reviewed as a whole: every course with whom it is for, then
 * every person once. A settled course is taken out from here; the one filled
 * last is edited through its steps, like a single course.
 */
function LotReview({
  catalog,
  items,
  onEdit,
  onRemove,
}: {
  catalog: PublicCatalog
  items: CheckoutItem[]
  onEdit: (step: StepId) => void
  onRemove: (index: number) => void
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale
  const last = items.length - 1

  const people: CheckoutItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const key = personKey(item.student)
    if (seen.has(key)) continue
    seen.add(key)
    people.push(item)
  }

  return (
    <>
      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-ink">{t('lot.review_courses', { count: items.length })}</p>
        <ul className="divide-y divide-line">
          {items.map((item, index) => {
            const course = courseById(catalog, item.course.courseId)
            const group = groupById(catalog, item.course.classGroupId)
            const plan = planOfCourse(catalog, item.course.courseId, item.course.planId)
            return (
              <li key={index} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{course?.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {`${item.student.firstName} ${item.student.lastName}`}
                      {plan ? ` · ${plan.name}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => (index === last ? onEdit('course') : onRemove(index))}
                    className="shrink-0 text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                  >
                    {index === last ? t('action.edit') : t('lot.remove_short')}
                  </button>
                </div>
                <dl className="mt-1 divide-y divide-line">
                  {group && (
                    <>
                      <SummaryRow label={t('summary.schedule')}>
                        {scheduleLines(
                          group,
                          (day) => t(`weekday.${day}`),
                          (vars) => t('time_range', vars),
                        ).map((line) => (
                          <span key={line.key} className="block">{`${line.day} — ${line.time}`}</span>
                        ))}
                      </SummaryRow>
                      <SummaryRow label={t('summary.starts_on')}>{formatDate(group.startDate, locale)}</SummaryRow>
                    </>
                  )}
                  {plan && (
                    <SummaryRow label={t('lot.price')}>{formatMoney(plan.amountCents, plan.currency, locale)}</SummaryRow>
                  )}
                </dl>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="p-5">
        <SectionHead
          title={t('lot.review_people', { count: people.length })}
          onEdit={() => onEdit('student')}
          editLabel={t('action.edit')}
        />
        <ul className="divide-y divide-line">
          {people.map((person) => (
            <li key={personKey(person.student)} className="py-3">
              <p className="text-sm font-semibold text-ink">{`${person.student.firstName} ${person.student.lastName}`}</p>
              <dl className="divide-y divide-line">
                <SummaryRow label={t('summary.document')}>
                  {`${t(`national_id_type.${person.student.nationalIdType}`)} ${person.student.nationalId}`}
                </SummaryRow>
                <SummaryRow label={t('summary.email')}>{person.student.email}</SummaryRow>
                <SummaryRow label={t('summary.phone')}>{person.student.phone}</SummaryRow>
                {person.guardian.consentAccepted && (
                  <SummaryRow label={t('step.review.guardian_section')}>
                    {`${person.guardian.firstName} ${person.guardian.lastName} · ${person.guardian.email}`}
                  </SummaryRow>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
