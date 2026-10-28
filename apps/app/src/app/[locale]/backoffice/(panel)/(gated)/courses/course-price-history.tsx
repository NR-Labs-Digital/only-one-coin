'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PlanDetail } from '@/lib/backoffice/types'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import { Card, EmptyState, SectionTitle } from '@/components/backoffice/ui'

/**
 * Every price each plan has had, newest first, on a tab of its own. Prices are
 * versioned and never edited (CLAUDE.md §5), so a plan that has been on sale
 * for a while carries dozens of them — the plans tab shows only the one in
 * force and the ones scheduled.
 */
export function CoursePriceHistory({ plans }: { plans: PlanDetail[] }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const now = Date.now()

  const withPast = plans
    .map((plan) => ({
      plan,
      prices: plan.prices
        .filter((price) => new Date(price.validFrom).getTime() <= now)
        .sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    }))
    .filter((entry) => entry.prices.length > 0)

  if (withPast.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState icon="payments" title={t('plans.history_empty_title')} body={t('plans.history_empty_body')} />
      </Card>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {withPast.map(({ plan, prices }) => (
        <Card as="section" key={plan.id} className="flex flex-col gap-3 p-5">
          <SectionTitle icon="payments">{plan.name}</SectionTitle>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {prices.map((price) => {
              const current = price.id === plan.currentPriceId
              return (
                <li key={price.id} className="flex items-baseline justify-between gap-2 py-2">
                  <span className={current ? 'font-semibold text-ink' : 'text-muted-foreground'}>
                    {formatDate(price.validFrom, locale)}
                    {current && (
                      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {t('plans.current')}
                      </span>
                    )}
                  </span>
                  <span
                    className={`tabular-nums ${current ? 'font-semibold text-ink' : 'text-muted-foreground'}`}
                  >
                    {formatMoney(price.amountCents, 'PEN', locale)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}
