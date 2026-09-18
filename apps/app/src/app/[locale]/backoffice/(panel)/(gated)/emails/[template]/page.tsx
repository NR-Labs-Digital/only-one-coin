import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getEmailFlow, getEmailMetrics } from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { BoIcon } from '@/components/backoffice/icons'
import { EmailFlowDetail } from './email-flow-detail'

/**
 * One automatic e-mail, on a page of its own: what it says, whether it goes
 * out, and how the window went.
 *
 * A page rather than a panel over the list, because this is where the template
 * is *read* — the whole message, at the width of a message — and because the
 * URL is worth having: somebody checking wording with a colleague sends this
 * link, not "open the e-mail screen and click the fourth row".
 *
 * The catalog is a closed union, so an id that names nothing answers
 * `notFound`. The role gate does the same rather than drawing an empty page:
 * the enforcing check is the role declared on the route in `apps/api`
 * (CLAUDE.md §8).
 */
export default async function EmailFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; template: string }>
  /** `from=journey` when the reader arrived from the flow — see below. */
  searchParams: Promise<{ from?: string }>
}) {
  const { locale, template } = await params
  const { from } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  const flow = getEmailFlow(template)
  if (!flow) notFound()

  /* Back goes where the reader actually was. Anything other than the flow —
     including a link somebody pasted — lands on the list, which is the
     section's front door. */
  const fromJourney = from === 'journey'

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={fromJourney ? '/backoffice/emails/journey' : '/backoffice/emails'}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t(fromJourney ? 'emails.back_journey' : 'emails.back')}
      </Link>


      {/* The header lives in the client half: the switch is up there with the
          state it changes, and that state is what the header reads. */}
      <EmailFlowDetail flow={flow} windowDays={getEmailMetrics().windowDays} />
    </div>
  )
}
