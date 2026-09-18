'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EmailFlow } from '@/lib/backoffice/types'
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  type Locale,
} from '@/lib/format'
import { Link } from '@/i18n/navigation'
import { AutoGrid } from '@/components/layout/auto-grid'
import {
  Card,
  PageHeader,
  SectionTitle,
  StatusBadge,
} from '@/components/backoffice/ui'
import { Toast, Toggle } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { ProofSend } from '../proof-send'

/**
 * The e-mail itself. Two columns where the column is wide enough for them: the
 * message on the left at the width it is read at, and everything you can *do*
 * to it on the right — switch, figures, proof.
 *
 * The split is a container query, not a viewport breakpoint: this page sits
 * inside the panel's column, and the same window gives it ~1000px with the
 * sidebar open and ~1170px with it collapsed (CLAUDE.md §7).
 *
 * The preview renders the versioned template from the repository over invented
 * sample data (CLAUDE.md §5, §8) — never a real student, and never the copy
 * somebody drew in the provider's panel. It renders in the panel's language
 * here; the person receiving it gets their own.
 */
export function EmailFlowDetail({
  flow,
  windowDays,
}: {
  flow: EmailFlow
  windowDays: number
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [enabled, setEnabled] = useState(flow.enabled)
  const [toast, setToast] = useState<string | null>(null)

  function toggle(next: boolean) {
    setEnabled(next)
    setToast(t(next ? 'emails.toast_enabled' : 'emails.toast_paused'))
  }

  /**
   * The sample the template renders over. The bag is shared by every string of
   * the preview — a template that does not name the guardian simply ignores it.
   */
  const values = {
    /* Who `{name}` is depends on who is reading it: the recipient, except on
       the guardian's templates, where the name in the text is the student and
       `{guardian}` is the person receiving it. */
    name:
      flow.audience === 'teacher'
        ? flow.sample.teacherName
        : flow.audience === 'staff'
          ? flow.sample.staffName
          : flow.sample.studentName,
    guardian: flow.sample.guardianName,
    course: flow.sample.courseName,
    classGroup: flow.sample.classGroupName,
    amount: formatMoney(flow.sample.amountCents, 'PEN', locale),
    date: formatDate(flow.sample.date, locale),
  }

  const to =
    flow.audience === 'guardian'
      ? { name: flow.sample.guardianName, address: flow.sample.guardianEmail }
      : flow.audience === 'teacher'
        ? { name: flow.sample.teacherName, address: flow.sample.teacherEmail }
        : flow.audience === 'staff'
          ? { name: flow.sample.staffName, address: flow.sample.staffEmail }
          : { name: flow.sample.studentName, address: flow.sample.studentEmail }

  const recipient = `${to.name} <${to.address}>`

  const rate = flow.metrics.sent === 0 ? null : flow.metrics.delivered / flow.metrics.sent

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t(`email_template.${flow.template}`)}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={enabled ? 'success' : 'warning'}
              label={t(enabled ? 'emails.state_on' : 'emails.state_off')}
            />
            <StatusBadge
              tone="neutral"
              dot={false}
              label={t(`email_audience.${flow.audience}`)}
            />
          </span>
        }
      />

      {/* The one question anybody opens this page with, asked out loud and
          answered — rather than a sentence under the title that reads as a
          caption nobody knows what to do with. */}
      <div className="-mt-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('emails.when_label')}
        </p>
        <p className="mt-0.5 text-sm text-ink">
          {t(`email_trigger.${flow.template}`)}
        </p>
      </div>

      <div className="grid gap-5 @4xl/page:grid-cols-3">
        {/* The message */}
        <section className="flex flex-col gap-3 @4xl/page:col-span-2">
          <SectionTitle icon="doc">{t('emails.preview_title')}</SectionTitle>
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-line bg-sky-soft px-5 py-4">
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">
                  {t('emails.preview_to')}
                </span>
                {/* Sample recipient — the address is invented with the person. */}
                <span className="text-ink">{recipient}</span>
              </p>
              <p className="text-base font-semibold text-ink">
                {t(`email_preview.${flow.template}.subject`, values)}
              </p>
            </div>
            <div className="flex flex-col gap-4 px-5 py-6 text-sm leading-relaxed text-ink sm:px-7">
              <p>{t(`email_preview.${flow.template}.p1`, values)}</p>
              <p>{t(`email_preview.${flow.template}.p2`, values)}</p>
              {/* The template's call to action, drawn as it lands in the
                  inbox — a real button here would invite a click that sends
                  nobody anywhere. */}
              <span className="mt-1 self-start rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white">
                {t(`email_preview.${flow.template}.cta`, values)}
              </span>
            </div>
          </Card>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('emails.preview_note')}
          </p>
        </section>

        {/* What you can do to it */}
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <SectionTitle icon="settings">{t('emails.state_title')}</SectionTitle>
            <Card className="p-4">
              <Toggle
                checked={enabled}
                onChange={toggle}
                label={t('emails.state_label')}
                hint={t(enabled ? 'emails.state_hint_on' : 'emails.state_hint_off')}
              />
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle icon="trend-up">
              {t('emails.metrics_title', { days: windowDays })}
            </SectionTitle>
            <AutoGrid min="8rem" gap="gap-2" as="dl">
              <Metric
                label={t('emails.metric_sent')}
                value={formatNumber(flow.metrics.sent, locale)}
              />
              <Metric
                label={t('emails.metric_delivered')}
                value={formatNumber(flow.metrics.delivered, locale)}
                hint={rate === null ? undefined : formatPercent(rate, locale)}
              />
              {/* Both of these are people, not figures — they open the list
                  of who never received this e-mail. */}
              <Metric
                label={t('emails.metric_bounced')}
                value={formatNumber(flow.metrics.bounced, locale)}
                tone={flow.metrics.bounced > 0 ? 'warning' : undefined}
                href={`/backoffice/emails/deliveries?state=bounced&template=${flow.template}`}
              />
              <Metric
                label={t('emails.metric_failed')}
                value={formatNumber(flow.metrics.failed, locale)}
                tone={flow.metrics.failed > 0 ? 'danger' : undefined}
                href={`/backoffice/emails/deliveries?state=failed&template=${flow.template}`}
              />
            </AutoGrid>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle icon="email">{t('emails.test_title')}</SectionTitle>
            <ProofSend
              onSent={(count) => setToast(t('emails.test_toast', { count }))}
            />
          </section>

          <p className="flex items-start gap-2 border-t border-line pt-4 text-xs text-muted-foreground">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('emails.no_send_notice')}
          </p>
        </div>
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

/**
 * One figure of the window. Copy arrives translated (CLAUDE.md §4).
 *
 * With an `href` it becomes a way in: the figures that count failures are
 * counting people, and a number nobody can open is a number nobody can act on.
 */
function Metric({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warning' | 'danger'
  href?: string
}) {
  const valueTone =
    tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-700' : 'text-ink'

  const inner = (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueTone}`}>
        {value}
        {hint && (
          <span className="ml-1.5 text-xs font-medium text-muted-foreground">{hint}</span>
        )}
      </dd>
    </>
  )

  const box = 'rounded-lg border border-line px-3 py-2'

  return href ? (
    <Link
      href={href}
      className={`${box} block transition hover:border-brand-yellow hover:bg-cream`}
    >
      {inner}
    </Link>
  ) : (
    <div className={box}>{inner}</div>
  )
}
