import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { EmailDeliveryState } from '@/lib/backoffice/types'
import { listEmailDeliveryIssues } from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { countDeliveryIssues } from '@/lib/backoffice/email-delivery'
import { PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { BoIcon } from '@/components/backoffice/icons'
import { DeliveriesView } from './deliveries-view'

const STATES: EmailDeliveryState[] = ['bounced', 'failed']

/**
 * The e-mails that did not land, and the people on the other end of them.
 *
 * This is the section's only screen about individuals rather than about the
 * catalog, and that is the point: a bounce counter says 54, and the student
 * whose credentials never arrived cannot get into the portal. Every row opens
 * that student's file — which is where the phone number to call them on lives.
 *
 * The state filter is a real route, so the numbers on the other screens can
 * link straight into the slice they name.
 */
export default async function EmailDeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ state?: string; template?: string }>
}) {
  const { locale } = await params
  const { state, template } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  const all = listEmailDeliveryIssues()
  const counts = countDeliveryIssues(all)

  const stateFilter = STATES.find((value) => value === state) ?? null
  const rows = all.filter(
    (item) =>
      (stateFilter === null || item.state === stateFilter) &&
      (template === undefined || item.template === template),
  )

  const filters: { label: string; href: string; active: boolean; count: number }[] = [
    {
      label: t('deliveries.filter_all'),
      href: '/backoffice/emails/deliveries',
      active: stateFilter === null,
      count: counts.total,
    },
    {
      label: t('deliveries.filter_bounced'),
      href: '/backoffice/emails/deliveries?state=bounced',
      active: stateFilter === 'bounced',
      count: counts.bounced,
    },
    {
      label: t('deliveries.filter_failed'),
      href: '/backoffice/emails/deliveries?state=failed',
      active: stateFilter === 'failed',
      count: counts.failed,
    },
  ]

  const active = filters.find((filter) => filter.active) ?? filters[0]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('deliveries.title')}
        actions={
          <Link
            href="/backoffice/emails/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep"
          >
            <BoIcon name="plus" size={16} />
            {t('emails.new')}
          </Link>
        }
      />
      <SectionTabs
        tabs={[
          { href: '/backoffice/emails', label: t('emails.tab_catalog'), exact: true },
          { href: '/backoffice/emails/journey', label: t('emails.tab_journey') },
          { href: '/backoffice/emails/deliveries', label: t('deliveries.tab') },
        ]}
      />

      {/* One control, not three chips sitting under the tabs pretending to be
          more of them. Real links inside it, so a number on another screen can
          still point straight at the slice it names — and a native disclosure,
          so the menu costs no client component. */}
      <details className="relative w-fit">
        {/* The button names the slice you are in and nothing else: the count
            is on every row of the menu, and repeating it here made the control
            read as a number to act on rather than as a filter. */}
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-brand-yellow hover:bg-cream hover:text-ink [&::-webkit-details-marker]:hidden">
          <BoIcon name="filter" size={16} />
          {active.label}
          <BoIcon name="chevron-down" size={14} />
        </summary>
        <div className="absolute left-0 top-12 z-20 flex w-60 flex-col gap-0.5 rounded-xl border border-line bg-white p-1.5 shadow-float">
          {filters.map((filter) => (
            <Link
              key={filter.href}
              href={filter.href}
              aria-current={filter.active ? 'page' : undefined}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition ${
                filter.active
                  ? 'bg-cream font-semibold text-ink'
                  : 'text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {filter.label}
              <span className="text-xs text-slate-400">{filter.count}</span>
            </Link>
          ))}
        </div>
      </details>

      <DeliveriesView rows={rows} />
    </div>
  )
}
