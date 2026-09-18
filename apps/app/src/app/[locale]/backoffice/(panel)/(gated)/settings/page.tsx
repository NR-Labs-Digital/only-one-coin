import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { getGeneralSettings } from '@/lib/backoffice/settings'
import { canConfigureSettings } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { AcademicSettingsForm } from './academic-form'

/**
 * Platform settings — the values every screen already runs on, in the one place
 * somebody can change them. One section, two screens (same pattern as
 * payments): this one holds the academic rules and procedures, the sibling
 * under `/settings/receipts` holds what the receipt pipeline approves on.
 *
 * Nothing here is a new rule. Each field is a constant the code itself flags as
 * belonging in the backoffice (`lib/backoffice/settings.ts`). Putting them
 * behind a screen is what stops a change of "aprobado" from being a deploy
 * (CLAUDE.md §5).
 *
 * Admin only. The gate here draws the form or the locked state; the check that
 * counts is the role declared on the route in `apps/api` (CLAUDE.md §8).
 */
export default async function SettingsPage({
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
        <EmptyState
          icon="shield"
          title={t('settings.locked_title')}
          body={t('settings.locked_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('settings.title')} />
      <SectionTabs
        tabs={[
          {
            href: '/backoffice/settings',
            label: t('settings.academic_title'),
            exact: true,
          },
          {
            href: '/backoffice/settings/receipts',
            label: t('settings.receipts_title'),
          },
        ]}
      />
      <AcademicSettingsForm settings={getGeneralSettings().academic} />
    </div>
  )
}
