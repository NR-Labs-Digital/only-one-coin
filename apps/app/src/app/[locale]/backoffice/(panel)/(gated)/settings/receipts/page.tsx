import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { getGeneralSettings } from '@/lib/backoffice/settings'
import { canConfigureSettings } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ReceiptSettingsForm } from './receipts-form'

/**
 * The receipt half of the settings section — the parameters the OCR ladder
 * approves on before it asks for a human, plus the seat's two clocks. The
 * academic half lives at the section index; the tabs bind the two screens to
 * the one sidebar entry (same pattern as payments).
 *
 * This block used to be its own screen under payments. It lives here whole
 * rather than being mirrored: two screens that both claim to own the same
 * number is how the two drift apart.
 *
 * Admin only. The gate here draws the form or the locked state; the check that
 * counts is the role declared on the route in `apps/api` (CLAUDE.md §8).
 */
export default async function ReceiptSettingsPage({
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
      <ReceiptSettingsForm settings={getGeneralSettings().receipts} />
    </div>
  )
}
