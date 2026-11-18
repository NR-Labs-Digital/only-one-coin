'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { env } from '@/env'
import type { CheckoutDraft, PublicCatalog } from '@/lib/enrollment/types'
import { checkoutItems, courseById, groupById } from '@/lib/enrollment/checkout'
import { scheduleLines } from '@/lib/enrollment/schedule'
import { formatDate, type Locale } from '@/lib/format'
import {
  Card,
  DotGrid,
  GhostButton,
  Note,
  PrimaryButton,
  SummaryRow,
} from '@/components/enrollment/ui'
import { CheckoutIcon } from '@/components/enrollment/icons'

/**
 * The screen after submit.
 *
 * It is careful not to congratulate anybody on being enrolled. The seat is
 * `reserved`, the payment is waiting on the OCR ladder and a human may still
 * look at it (`CLAUDE.md` §5) — a page saying "¡Matrícula confirmada!" here is
 * a page that generates a support conversation the day one gets rejected.
 *
 * What it does instead is state the three things the reader actually needs:
 * what was received, what happens next, and when to expect the credentials.
 *
 * And it gives them a way out. A terminal screen with no action leaves the
 * reader holding a finished task and a page that will not let go of them —
 * back to the site for most, a second enrolment for the parent registering a
 * sibling, and the tracking code copyable, because it is the one thing here
 * worth keeping.
 */
export function Submitted({
  catalog,
  draft,
  reference,
  onRestart,
}: {
  catalog: PublicCatalog
  draft: CheckoutDraft
  /** Human-readable handle for the request. Not a technical id (`CLAUDE.md` §4). */
  reference: string
  onRestart: () => void
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale
  const [copied, setCopied] = useState(false)

  const siteUrl = env.NEXT_PUBLIC_LANDING_URL ?? '/'

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // A browser that refuses the clipboard still shows the code on screen.
    }
  }

  const course = courseById(catalog, draft.course.courseId)
  const group = groupById(catalog, draft.course.classGroupId)
  const notifyEmail = draft.guardian.consentAccepted
    ? draft.guardian.email
    : draft.student.email

  const steps = ['received', 'review', 'credentials'] as const
  // Several courses, one receipt (OOC-158): every one of them is listed.
  const items = checkoutItems(draft)

  return (
    <div className="flex flex-col gap-5">
      <Card className="relative overflow-hidden p-6 text-center sm:p-8">
        <DotGrid className="-left-6 -top-6" />
        <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <CheckoutIcon name="check" size={28} />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {t('submitted.title')}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t('submitted.subtitle', { email: notifyEmail })}
        </p>
        <button
          type="button"
          onClick={() => void copyReference()}
          className="mx-auto mt-4 flex items-center gap-2 rounded-xl bg-sky px-4 py-2 transition hover:bg-brand-blue/10"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('submitted.reference_label')}
          </span>
          <span className="font-mono text-sm font-bold text-ink">{reference}</span>
          <CheckoutIcon
            name={copied ? 'check' : 'copy'}
            size={15}
            className="text-brand-blue"
          />
          <span className="sr-only">{copied ? t('action.copied') : t('action.copy')}</span>
        </button>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-ink">
          {t('submitted.what_now')}
        </p>
        <ol className="flex flex-col gap-4">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  i === 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-sky text-muted-foreground'
                }`}
              >
                {i === 0 ? <CheckoutIcon name="check" size={14} /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col leading-snug">
                <span className="text-sm font-semibold text-ink">
                  {t(`submitted.timeline.${step}.title`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`submitted.timeline.${step}.body`, {
                    days: catalog.settings.reservationDays,
                  })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {items.length > 1 && (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-ink">
            {t('lot.submitted_summary', { count: items.length })}
          </p>
          <ul className="divide-y divide-line">
            {items.map((item, index) => {
              const itemCourse = courseById(catalog, item.course.courseId)
              const itemGroup = groupById(catalog, item.course.classGroupId)
              return (
                <li key={index} className="py-2">
                  <span className="block text-sm font-semibold text-ink">{itemCourse?.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      `${item.student.firstName} ${item.student.lastName}`,
                      itemGroup ? t('lot.starts_on', { date: formatDate(itemGroup.startDate, locale) }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {items.length === 1 && course && group && (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-ink">
            {t('submitted.summary_label')}
          </p>
          <dl className="divide-y divide-line">
            <SummaryRow label={t('summary.course')}>{course.name}</SummaryRow>
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
          </dl>
        </Card>
      )}

      {/* Every class is online (`CLAUDE.md` §1) — no address, no campus, and
          nothing that could read as one. */}
      <Note tone="info">{t('submitted.online_note')}</Note>

      {/* The way out. Back to the site is what most people want; a second
          enrolment is the parent who has another child to register, which is
          common enough here to deserve a button rather than a re-typed URL. */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <PrimaryButton href={siteUrl}>
          {t('submitted.back_to_site')}
          <CheckoutIcon name="arrow-right" size={16} />
        </PrimaryButton>
        <GhostButton onClick={onRestart}>
          {t('submitted.new_enrollment')}
        </GhostButton>
      </div>
    </div>
  )
}
