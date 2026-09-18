import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { EmailFlow } from '@/lib/backoffice/types'
import { listEmailFlows } from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { buildEmailJourney } from '@/lib/backoffice/email-journey'
import { PageHeader, StatusBadge } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The flow: what happens, in order, and what leaves because of it.
 *
 * The spine is the domain events — the form arriving, the receipt being
 * validated, the payment decided — because that is what actually runs in
 * sequence. The e-mails hang off them as branches, which is what they are: a
 * transactional message is a consequence, never a step of its own
 * (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4).
 *
 * A branch that only fires sometimes says its condition on the connector and
 * carries a dashed line, so the path the case may never take never looks like
 * the path everybody walks. Nothing else is written on the diagram: how to read
 * it lives behind the `?`, where somebody looks once and never again.
 *
 * A static route, so it wins over `[template]` — and the template ids are a
 * closed union with nothing named `journey` in it.
 */
export default async function EmailJourneyPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  const journey = buildEmailJourney(listEmailFlows())

  /** Whole card is the target: the reader is aiming at a box, not at a word. */
  function node(flow: EmailFlow) {
    return (
      <Link
        key={flow.template}
        /* Says where the reader came from, so the e-mail's page can send
           them back to the flow instead of dropping them in the list. A query
           param rather than history: it survives a refresh and a shared link. */
        href={`/backoffice/emails/${flow.template}?from=journey`}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-card transition hover:border-brand-yellow hover:bg-cream"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {t(`email_template.${flow.template}`)}
        </span>
        {flow.audience === 'guardian' && (
          <span className="shrink-0 rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
            {t('email_audience.guardian')}
          </span>
        )}
        {!flow.enabled && <StatusBadge tone="warning" label={t('emails.state_off')} />}
        <BoIcon
          name="chevron-right"
          size={16}
          className="shrink-0 text-muted-foreground transition group-hover:text-ink"
        />
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('emails.journey_title')}
        /* The section's action stays put across its tabs — a button that
           appears and disappears as you switch reads as two different pages. */
        actions={
          <span className="flex items-center gap-2">
            {/* Native disclosure: the legend somebody reads once, folded away
                by default, and no client component to carry a boolean. */}
            <details className="relative">
              <summary
                aria-label={t('emails.help')}
                title={t('emails.help')}
                className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-line bg-white text-muted-foreground transition hover:border-brand-yellow hover:bg-cream hover:text-ink [&::-webkit-details-marker]:hidden"
              >
                <BoIcon name="help" size={18} />
              </summary>
              <div className="absolute right-0 top-11 z-20 flex w-72 flex-col gap-2 rounded-xl border border-line bg-white p-4 text-xs text-muted-foreground shadow-float">
                <p className="text-sm font-semibold text-ink">{t('emails.help')}</p>
                <p>{t('emails.help_condition')}</p>
                <p>{t('emails.help_guardian')}</p>
                <p>{t('emails.help_paused')}</p>
                <p>{t('emails.help_open')}</p>
              </div>
            </details>

            <Link
              href="/backoffice/emails/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep"
            >
              <BoIcon name="plus" size={16} />
              {t('emails.new')}
            </Link>
          </span>
        }
      />
      <SectionTabs
        tabs={[
          { href: '/backoffice/emails', label: t('emails.tab_catalog'), exact: true },
          { href: '/backoffice/emails/journey', label: t('emails.tab_journey') },
          { href: '/backoffice/emails/deliveries', label: t('deliveries.tab') },
        ]}
      />

      <ol className="flex flex-col">
        {journey.map((step, index) => {
          const last = index === journey.length - 1
          return (
            <li key={step.stage} className="relative pb-8 pl-10 last:pb-0">
              {/* The line runs the whole way down and stops at the last event —
                  it is the sequence itself, not a decoration. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[11px] top-2 w-0.5 bg-line"
                />
              )}
              <span
                aria-hidden="true"
                className="absolute left-[11px] top-1.5 size-3 -translate-x-1/2 rounded-full bg-brand-blue ring-4 ring-sky"
              />

              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
                {t(`email_stage.${step.stage}`)}
              </h2>

              <div className="mt-3 flex flex-col gap-2">
                {step.flows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                    {t('emails.journey_empty')}
                  </p>
                ) : (
                  step.flows.map((flow) => {
                    /* The condition is information, not decoration: it says
                       when this e-mail leaves at all. It rides the branch on a
                       wide column and sits above the box on a narrow one. */
                    const condition = flow.conditional ? (
                      <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {t(`email_condition.${flow.template}`)}
                      </span>
                    ) : null
                    const rail = (
                      <span
                        aria-hidden="true"
                        className={`h-0 flex-1 border-t-2 ${
                          flow.conditional
                            ? 'border-dashed border-slate-300'
                            : 'border-line'
                        }`}
                      />
                    )
                    return (
                      <div
                        key={flow.template}
                        className="flex flex-col gap-1.5 @2xl/page:flex-row @2xl/page:items-center @2xl/page:gap-0"
                      >
                        {/* The branch: solid for what always leaves, dashed
                            and labelled for what leaves only sometimes. The
                            slot is a fixed width so every box starts on the
                            same line — a ragged left edge is what made this
                            read as a pile of cards instead of a flow.
                            Num telefone os trilhos somem: 208px de linha
                            horizontal mais a caixa não cabem em 343px, e a
                            linha vertical da timeline já diz a sequência. */}
                        <span className="hidden w-52 shrink-0 items-center gap-1.5 @2xl/page:flex">
                          {rail}
                          {condition}
                          <span
                            aria-hidden="true"
                            className={`h-0 w-3 border-t-2 ${
                              flow.conditional
                                ? 'border-dashed border-slate-300'
                                : 'border-line'
                            }`}
                          />
                        </span>
                        {condition && (
                          <span className="@2xl/page:hidden">{condition}</span>
                        )}
                        {node(flow)}
                      </div>
                    )
                  })
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
