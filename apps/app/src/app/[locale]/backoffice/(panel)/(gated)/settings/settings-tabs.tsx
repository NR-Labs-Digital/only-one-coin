import { getTranslations } from 'next-intl/server'
import { SectionTabs } from '@/components/backoffice/section-tabs'

/**
 * The settings section's screens under one sidebar entry: academic rules at
 * the index and the receipt pipeline. The document templates (OOC-123) moved
 * to the NR Labs area on 28/11/2026.
 */
export async function SettingsTabs() {
  const t = await getTranslations('bo')
  return (
    <SectionTabs
      tabs={[
        { href: '/backoffice/settings', label: t('settings.academic_title'), exact: true },
        { href: '/backoffice/settings/receipts', label: t('settings.receipts_title') },
      ]}
    />
  )
}
