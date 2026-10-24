import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canConfigureSettings } from '@/lib/backoffice/permissions'
import { getDocumentTemplate } from '@/lib/backoffice/document-templates'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { DocumentEditor } from '@/components/backoffice/documents/document-editor'
import { SettingsTabs } from '../settings-tabs'

/**
 * The text of the documents the platform prints (OOC-123) — today the teacher
 * contract. Edited visually beside the real PDF; published versions are what
 * every document is issued from.
 *
 * Management only (decision of 23/10/2026), the same people as the rest of the
 * settings. The gate here draws the editor or the locked state; the check that
 * counts is the role declared on the routes in `apps/api` (CLAUDE.md §8).
 */
export default async function DocumentSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canConfigureSettings(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('settings.title')} />
        <EmptyState icon="shield" title={t('settings.locked_title')} body={t('settings.locked_body')} />
      </div>
    )
  }

  /* A failure is shown as a failure: an empty editor that looked loaded would
     overwrite the real text on the first save. */
  const view = await getDocumentTemplate('teacher_contract')

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('settings.title')} />
      <SettingsTabs />
      {view ? (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-ink">{t('documents.kind.teacher_contract')}</h2>
            <p className="text-sm text-muted-foreground">{t('documents.intro')}</p>
          </div>
          <DocumentEditor kind="teacher_contract" view={view} />
        </>
      ) : (
        <EmptyState icon="alert" title={t('documents.load_error_title')} body={t('documents.load_error_body')} />
      )}
    </div>
  )
}
