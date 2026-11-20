import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { NewEmailForm } from './new-email-form'
import { campaignAudience } from './campaign-audience'

/**
 * A send written by hand — the notice that is nobody's automatic consequence:
 * a class group changing time, a period opening (`docs/ROADMAP.md` fase 5).
 *
 * Four steps, in the order the mistakes happen: who it reaches, what it says,
 * a proof to a real inbox, and only then the approval. The proof stops counting
 * the moment the text changes, so nobody approves a message that was edited
 * after being checked.
 *
 * The segment is a question, never a list: it is resolved against the register
 * at send time and never handed to the provider to keep.
 */
export default async function NewEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  /* The segment is a question for the database, answered on the server —
     the browser is not the one holding the register. No route answers it
     yet (Fase 5), so the audience is empty, never invented. */
  const audience = campaignAudience()

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/emails"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('new_email.back')}
      </Link>

      <PageHeader title={t('new_email.title')} />

      <NewEmailForm
        allCount={audience.allCount}
        courses={audience.courses}
        classGroups={audience.classGroups}
        statuses={audience.statuses}
      />
    </div>
  )
}
