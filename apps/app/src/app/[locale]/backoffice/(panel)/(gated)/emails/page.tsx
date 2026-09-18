import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  getEmailMetrics,
  listEmailDeliveryIssues,
  listEmailFlows,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { countDeliveryIssues } from '@/lib/backoffice/email-delivery'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { BoIcon } from '@/components/backoffice/icons'
import { EmailsView } from './emails-view'

/**
 * The e-mail module. One section, three screens: the whole set of automatic
 * e-mails, the journey that says where each one fires, and the composer for a
 * send written by hand.
 *
 * This one is the set — names, state and numbers, scanned at once. What an
 * individual e-mail is *for* is the journey's job, and what it says is its own
 * page: three questions, three screens, instead of one table trying to answer
 * all three on every row.
 *
 * The preview elsewhere renders the versioned template from the repository,
 * never the one drawn in the provider's panel (CLAUDE.md §5).
 */
export default async function EmailsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  const undelivered = countDeliveryIssues(listEmailDeliveryIssues())

  if (!canManageEmail(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('emails.title')} />
        {/* The screen says the section is not theirs; the role declared on the
            route in `apps/api` is what enforces it (CLAUDE.md §8). */}
        <EmptyState
          icon="shield"
          title={t('emails.locked_title')}
          body={t('emails.locked_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('emails.title')}
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

      {/* The one thing on this screen that is somebody's errand today: an
          e-mail that never reached a person, sitting above the numbers rather
          than inside them. */}
      {undelivered.total > 0 && (
        <Link
          href="/backoffice/emails/deliveries"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:border-brand-yellow hover:bg-cream"
        >
          <BoIcon name="alert" size={16} className="shrink-0" />
          {t('deliveries.quick_action', { count: undelivered.total })}
          <span className="ml-auto inline-flex items-center gap-1 text-brand-blue">
            {t('deliveries.quick_action_link')}
            <BoIcon name="chevron-right" size={16} />
          </span>
        </Link>
      )}
      <EmailsView flows={listEmailFlows()} metrics={getEmailMetrics()} />
    </div>
  )
}
