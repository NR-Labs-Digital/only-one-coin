'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EmailFlow, EmailLocale, EmailPreview } from '@/lib/backoffice/types'
import { formatNumber, type Locale } from '@/lib/format'
import { Link } from '@/i18n/navigation'
import { AutoGrid } from '@/components/layout/auto-grid'
import {
  Card,
  PageHeader,
  SectionTitle,
  StatusBadge,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { ProofSend } from '../proof-send'
import { EmailFlowState } from '../email-flow-state'

/** The panel's route code for each e-mail locale — what the language names are keyed by. */
const ROUTE_LOCALE: Record<EmailLocale, Locale> = { 'es-PE': 'es', 'pt-BR': 'pt', en: 'en' }

/**
 * The e-mail itself. Two columns where the column is wide enough for them: the
 * message on the left at the width it is read at, and the figures and the proof
 * on the right.
 *
 * The split is a container query, not a viewport breakpoint: this page sits
 * inside the panel's column, and the same window gives it ~1000px with the
 * sidebar open and ~1170px with it collapsed (CLAUDE.md §7).
 *
 * The preview is the versioned template from the repository, rendered by the
 * API with the worker's own `renderEmail` over invented sample data (OOC-88) —
 * never a real student, never a copy written for this screen. All three
 * languages come at once, so the reader compares them with a tab instead of
 * switching the panel's language; it opens on the panel's own.
 */
export function EmailFlowDetail({
  flow,
  windowDays,
  previews,
}: {
  flow: EmailFlow
  windowDays: number
  /** The three renders, es-PE first; null when nothing sends it yet or the read failed. */
  previews: EmailPreview[] | null
}) {
  const t = useTranslations('bo')
  const tRoot = useTranslations()
  const locale = useLocale() as Locale

  const [shown, setShown] = useState<EmailLocale>(
    previews?.find((preview) => ROUTE_LOCALE[preview.locale] === locale)?.locale ?? 'es-PE',
  )
  const [toast, setToast] = useState<string | null>(null)

  const preview = previews?.find((item) => item.locale === shown) ?? null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t(`email_template.${flow.template}`)}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <EmailFlowState emitted={flow.emitted} />
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle icon="doc">{t('emails.preview_title')}</SectionTitle>
            {flow.version && (
              /* Derived from the words in all three languages: the same
                 value means the same e-mail somebody already reviewed. */
              <StatusBadge
                tone="neutral"
                dot={false}
                label={t('emails.version_label', { version: flow.version })}
              />
            )}
          </div>

          {!flow.emitted ? (
            <Card className="p-5">
              <p className="text-sm text-muted-foreground">
                {t('emails.preview_not_emitted')}
              </p>
            </Card>
          ) : !previews || !preview ? (
            <Card className="p-5">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
                {t('emails.preview_load_error')}
              </p>
            </Card>
          ) : (
            <>
              <div
                role="tablist"
                aria-label={t('emails.preview_locale_label')}
                className="flex flex-wrap gap-1.5"
              >
                {previews.map((item) => {
                  const on = item.locale === shown
                  return (
                    <button
                      key={item.locale}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setShown(item.locale)}
                      className={`min-h-tap rounded-lg border px-3 text-sm font-semibold transition ${
                        on
                          ? 'border-brand-blue bg-brand-blue text-white'
                          : 'border-line bg-white text-muted-foreground hover:border-brand-yellow hover:bg-cream hover:text-ink'
                      }`}
                    >
                      {tRoot(`language.${ROUTE_LOCALE[item.locale]}`)}
                    </button>
                  )
                })}
              </div>

              <Card className="overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-line bg-sky-soft px-5 py-4">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">
                      {t('emails.preview_to')}
                    </span>
                    {/* Sample recipient — invented with the person. */}
                    <span className="break-all text-ink">{preview.to}</span>
                  </p>
                  <p className="text-base font-semibold text-ink">{preview.subject}</p>
                </div>
                {/* The HTML the student's mail client receives, drawn as is.
                    Sandboxed with nothing allowed back in: the button is a
                    link, and a preview has nowhere to send anybody. */}
                <iframe
                  key={preview.locale}
                  title={t('emails.preview_frame_title', {
                    language: tRoot(`language.${ROUTE_LOCALE[preview.locale]}`),
                  })}
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-[34rem] w-full bg-white"
                />
              </Card>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('emails.preview_note')}
              </p>
            </>
          )}
        </section>

        {/* The figures, and the proof */}
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <SectionTitle icon="trend-up">
              {t('emails.metrics_title', { days: windowDays })}
            </SectionTitle>
            <AutoGrid min="8rem" gap="gap-2" as="dl">
              <Metric
                label={t('emails.metric_sent')}
                value={formatNumber(flow.counts.sent, locale)}
              />
              {/* The provider's to report back; its webhook does not exist
                  yet. Said out loud rather than drawn as a zero. */}
              <Metric
                label={t('emails.metric_delivered')}
                value={t('emails.metric_unavailable')}
                muted
              />
              <Metric
                label={t('emails.metric_bounced')}
                value={t('emails.metric_unavailable')}
                muted
              />
              {/* A failure is a person who never received this e-mail — it
                  opens the list of them. */}
              <Metric
                label={t('emails.metric_failed')}
                value={formatNumber(flow.counts.failed, locale)}
                tone={flow.counts.failed > 0 ? 'danger' : undefined}
                href={`/backoffice/emails/deliveries?state=failed&template=${flow.template}`}
              />
              <Metric
                label={t('emails.metric_blocked')}
                value={formatNumber(flow.counts.blocked, locale)}
              />
            </AutoGrid>
            <p className="text-xs text-muted-foreground">
              {t('emails.metric_unavailable_hint')}
            </p>
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
  tone,
  muted,
  href,
}: {
  label: string
  value: string
  tone?: 'danger'
  /** A figure that does not exist yet: drawn as a word, not a number. */
  muted?: boolean
  href?: string
}) {
  const valueTone =
    tone === 'danger' ? 'text-red-600' : muted ? 'text-muted-foreground' : 'text-ink'

  const inner = (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-semibold tabular-nums ${muted ? 'text-sm' : 'text-lg'} ${valueTone}`}
      >
        {value}
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
