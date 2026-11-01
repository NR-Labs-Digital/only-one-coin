import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { EmailTemplate } from '@/lib/backoffice/types'
import { getEmailDeliveryIssues } from '@/lib/backoffice/email-delivery'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEmail, canResendEmail } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { BoIcon } from '@/components/backoffice/icons'
import { DeliveriesView } from './deliveries-view'

/**
 * The templates the API lists here — the ones about a student
 * (`STUDENT_DELIVERY_SUBJECTS`, `packages/domain`). Staff e-mails have no file
 * to open, and the checkout's code expires before anyone could act on it.
 */
const TEMPLATES: EmailTemplate[] = [
  'enrollment_received',
  'payment_under_review',
  'payment_approved',
  'payment_rejected',
  'portal_credentials',
  'portal_password_reset',
]

/**
 * The e-mails that did not land, and the people on the other end of them
 * (OOC-90): the outbox rows that ended `failed` and nobody resent yet.
 *
 * This is the section's only screen about individuals rather than about the
 * catalog, and that is the point: a failure counter says 54, and the student
 * whose credentials never arrived cannot get into the portal. Every row opens
 * that student's file — which is where the phone number to call them on lives.
 *
 * Only failed sends exist for now. A bounce, a full mailbox or an unknown
 * address are what the provider's webhook reports, and nothing listens to it
 * yet — the screen does not pretend to know them.
 *
 * The template filter is a real route, so the numbers on the other screens can
 * link straight into the slice they name.
 */
export default async function EmailDeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ template?: string }>
}) {
  const { locale } = await params
  const { template } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  const templateFilter = TEMPLATES.find((value) => value === template) ?? null
  const issues = await getEmailDeliveryIssues(templateFilter ?? undefined)

  const filters: { label: string; href: string; active: boolean }[] = [
    {
      label: t('deliveries.filter_all'),
      href: '/backoffice/emails/deliveries',
      active: templateFilter === null,
    },
    ...TEMPLATES.map((value) => ({
      label: t(`email_template.${value}`),
      href: `/backoffice/emails/deliveries?template=${value}`,
      active: templateFilter === value,
    })),
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

      {/* One control, not a row of chips under the tabs pretending to be more
          of them. Real links inside it, so a number on another screen can
          still point straight at the slice it names — and a native disclosure,
          so the menu costs no client component. */}
      <details className="relative w-fit">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-brand-yellow hover:bg-cream hover:text-ink [&::-webkit-details-marker]:hidden">
          <BoIcon name="filter" size={16} />
          {active.label}
          <BoIcon name="chevron-down" size={14} />
        </summary>
        <div className="absolute left-0 top-12 z-20 flex w-64 flex-col gap-0.5 rounded-xl border border-line bg-white p-1.5 shadow-float">
          {filters.map((filter) => (
            <Link
              key={filter.href}
              href={filter.href}
              aria-current={filter.active ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                filter.active
                  ? 'bg-cream font-semibold text-ink'
                  : 'text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </details>

      {/* "Everything arrived" and "could not load" are different facts. */}
      {issues === null ? (
        <EmptyState
          icon="alert"
          title={t('deliveries.load_error_title')}
          body={t('deliveries.load_error_body')}
        />
      ) : (
        <DeliveriesView
          rows={issues.items}
          total={issues.total}
          canResend={canResendEmail(staff.role)}
        />
      )}
    </div>
  )
}
