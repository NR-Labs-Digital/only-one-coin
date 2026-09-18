'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { EmailFlow, EmailMetrics } from '@/lib/backoffice/types'
import { formatNumber, formatPercent, type Locale } from '@/lib/format'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import {
  Card,
  EmptyState,
  StatCard,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
  rowActionClass,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'

/** Nobody outside the institution ever receives these. */
function isInternal(flow: EmailFlow): boolean {
  return flow.audience === 'teacher' || flow.audience === 'staff'
}

type AudienceFilter = 'all' | 'external' | 'internal'

const AUDIENCE_FILTERS: AudienceFilter[] = ['all', 'external', 'internal']

/** Share of what left that the receiving server accepted. */
function deliveryRate(flow: EmailFlow): number | null {
  return flow.metrics.sent === 0 ? null : flow.metrics.delivered / flow.metrics.sent
}

/**
 * The catalog of automatic e-mails. Search and the paused filter run in the
 * browser because the list is mocked and short — ten rows that grow to maybe
 * twenty, not a ledger, so it is never paged.
 *
 * The list only ever reads. Switching a flow, and reading the template it
 * renders, happen on the e-mail's own page: turning off the one that carries
 * the portal credentials means nobody gets in, and that is not a decision to
 * hand to a stray click in a list.
 */
export function EmailsView({
  flows,
  metrics,
}: {
  flows: EmailFlow[]
  metrics: EmailMetrics
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState<AudienceFilter>('all')
  const [pausedOnly, setPausedOnly] = useState(false)
  /* Names and triggers are translated, so the search runs over what the reader
     actually sees — searching the template codes would find nothing they typed. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return flows.filter((flow) => {
      if (audience === 'external' && isInternal(flow)) return false
      if (audience === 'internal' && !isInternal(flow)) return false
      if (pausedOnly && flow.enabled) return false
      if (!needle) return true
      /* Search what is on screen: the trigger sentence moved to the journey,
         so matching on it would find rows the reader cannot see the reason for. */
      return [
        t(`email_template.${flow.template}`),
        t(`email_audience.${flow.audience}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [flows, query, audience, pausedOnly, t])

  const pausedCount = flows.filter((flow) => !flow.enabled).length

  const activeFilters = (audience === 'all' ? 0 : 1) + (pausedOnly ? 1 : 0)

  const audienceCounts: Record<AudienceFilter, number> = {
    all: flows.length,
    external: flows.filter((flow) => !isInternal(flow)).length,
    internal: flows.filter(isInternal).length,
  }

  /**
   * The whole row opens the e-mail, and the button inside it stays a real
   * link — so keyboard, screen reader and ctrl+click keep working.
   */
  function rowProps(template: string) {
    const href = `/backoffice/emails/${template}`
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        router.push(href)
      },
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AutoGrid min="15rem">
        <StatCard
          icon="email"
          label={t('emails.stat_sent')}
          value={formatNumber(metrics.sent, locale)}
          hint={t('emails.stat_sent_hint', { days: metrics.windowDays })}
        />
        <StatCard
          icon="check"
          tone="success"
          label={t('emails.stat_delivered')}
          value={formatNumber(metrics.delivered, locale)}
          hint={t('emails.stat_delivered_hint', {
            rate: formatPercent(
              metrics.sent === 0 ? 0 : metrics.delivered / metrics.sent,
              locale,
            ),
          })}
        />
        {/* The only number here somebody can act on: it names people, so it
            opens the list of them. */}
        <Link
          href="/backoffice/emails/deliveries?state=bounced"
          className="rounded-xl transition hover:brightness-[0.98]"
        >
          <StatCard
            icon="alert"
            tone={metrics.bounced > 0 ? 'warning' : 'neutral'}
            label={t('emails.stat_bounced')}
            value={formatNumber(metrics.bounced, locale)}
            hint={t('emails.stat_bounced_hint')}
          />
        </Link>
        {/* A paused flow is the one number on this header that is somebody's
            errand — it counts people who are waiting for an e-mail that is
            never coming. */}
        <StatCard
          icon="clock"
          tone={pausedCount > 0 ? 'warning' : 'neutral'}
          label={t('emails.stat_paused')}
          value={formatNumber(pausedCount, locale)}
          hint={t('emails.stat_paused_hint', { count: pausedCount })}
        />
      </AutoGrid>

      {/* One control instead of a row of chips under the tabs: the panel opens
          on demand, and the badge says how many cuts are on without it having
          to spell them out. Same shape as the teacher roster's. */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('emails.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('emails.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          <FiltersDropdown
            label={t('emails.filters')}
            count={activeFilters}
            panelClassName="w-60 flex-col gap-0.5 p-1.5"
          >
            <>
                {AUDIENCE_FILTERS.map((value) => {
                  const on = audience === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAudience(value)}
                      aria-pressed={on}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        on
                          ? 'bg-cream font-semibold text-ink'
                          : 'text-muted-foreground hover:bg-cream hover:text-ink'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {on && <BoIcon name="check" size={14} />}
                        {t(`emails.filter_${value}`)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {audienceCounts[value]}
                      </span>
                    </button>
                  )
                })}

                <span aria-hidden="true" className="my-1 h-px bg-line" />

                <button
                  type="button"
                  onClick={() => setPausedOnly(!pausedOnly)}
                  aria-pressed={pausedOnly}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    pausedOnly
                      ? 'bg-cream font-semibold text-ink'
                      : 'text-muted-foreground hover:bg-cream hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {pausedOnly && <BoIcon name="check" size={14} />}
                    {t('emails.filter_paused')}
                  </span>
                  <span className="text-xs text-slate-400">{pausedCount}</span>
                </button>
            </>
          </FiltersDropdown>
        </Toolbar>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="search"
              title={t('emails.empty_title')}
              body={t('emails.empty_body')}
            />
          </div>
        ) : (
          <TableShell
            columns={[
              t('emails.col_flow'),
              t('emails.col_audience'),
              t('emails.col_state'),
              t('emails.col_sent'),
              t('emails.col_delivered'),
              '',
            ]}
          >
            <thead>
              <tr>
                <th className={thClass}>{t('emails.col_flow')}</th>
                <th className={thClass}>{t('emails.col_audience')}</th>
                <th className={thClass}>{t('emails.col_state')}</th>
                <th className={`${thClass} text-right`}>{t('emails.col_sent')}</th>
                <th className={`${thClass} text-right`}>{t('emails.col_delivered')}</th>
                <th className={thClass}>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((flow) => {
                const rate = deliveryRate(flow)
                return (
                  <tr key={flow.template} {...rowProps(flow.template)}>
                    {/* The name and nothing under it. What each e-mail is
                        for, and where it fires, is the journey's job — here
                        the reader is scanning the whole set at once. */}
                    <td className={tdClass}>
                      <Link
                        href={`/backoffice/emails/${flow.template}`}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {t(`email_template.${flow.template}`)}
                      </Link>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}>
                      {t(`email_audience.${flow.audience}`)}
                    </td>
                    <td className={tdClass}>
                      <StatusBadge
                        tone={flow.enabled ? 'success' : 'warning'}
                        label={t(flow.enabled ? 'emails.state_on' : 'emails.state_off')}
                      />
                    </td>
                    <td
                      className={`${tdClass} text-right text-sm tabular-nums text-ink`}
                    >
                      {formatNumber(flow.metrics.sent, locale)}
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <span className="flex flex-col leading-tight">
                        <span className="text-sm tabular-nums text-ink">
                          {formatNumber(flow.metrics.delivered, locale)}
                        </span>
                        {rate !== null && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatPercent(rate, locale)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <Link
                        href={`/backoffice/emails/${flow.template}`}
                        className={rowActionClass}
                      >
                        {t('emails.open')}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  )
}
