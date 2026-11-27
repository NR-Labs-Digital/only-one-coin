import { notFound } from 'next/navigation'
import { isEditableEmailKey } from '@ooc/domain/email-catalog'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { isEmailTemplate } from '@/lib/backoffice/emails'
import { getEmailTemplate } from '@/lib/backoffice/email-templates'
import { getStaffSession } from '@/lib/backoffice/session'
import { canEditEmailTemplate, canManageEmail, canSendEmailProof } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { EmailTemplateEditor } from '@/components/backoffice/emails/email-template-editor'

/**
 * The words of one automatic e-mail, edited in the panel (OOC-60). Its own
 * page, under the e-mail it edits: the detail is where an e-mail is read, this
 * is where it is rewritten, side by side with the real render.
 *
 * Only the student's e-mails open here (the shared catalog's
 * `isEditableEmailKey`) — staff and security messages answer `notFound`. Who
 * reads the e-mail section reads this page; who holds the edit permission
 * saves and publishes. The check that counts is the API's (CLAUDE.md §8).
 */
export default async function EmailTemplateEditPage({
  params,
}: {
  params: Promise<{ locale: string; template: string }>
}) {
  const { locale, template } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff)) notFound()
  if (!isEmailTemplate(template) || !isEditableEmailKey(template)) notFound()

  /* A failure is shown as a failure: an empty editor that looked loaded would
     overwrite the real words on the first save. */
  const view = await getEmailTemplate(template)

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/backoffice/emails/${template}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('email_editor.back')}
      </Link>
      <PageHeader
        title={t('email_editor.title', { email: t(`email_template.${template}`) })}
        actions={<HelpHint what={t('help.email_editor_what')} how={t('help.email_editor_how')} />}
      />
      {view ? (
        <EmailTemplateEditor
          view={view}
          canEdit={canEditEmailTemplate(staff)}
          canSendProof={canSendEmailProof(staff)}
        />
      ) : (
        <EmptyState icon="alert" title={t('emails.load_error_title')} body={t('emails.load_error_body')} />
      )}
    </div>
  )
}
