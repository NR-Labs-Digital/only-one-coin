import { getTranslations } from 'next-intl/server'
import { SectionTabs } from '@/components/backoffice/section-tabs'

/**
 * The settings section's three screens under one sidebar entry: academic rules
 * at the index, the receipt pipeline, and the document templates (OOC-123).
 */
export async function SettingsTabs() {
  const t = await getTranslations('bo')
  return (
    <SectionTabs
      tabs={[
        { href: '/backoffice/settings', label: t('settings.academic_title'), exact: true },
        { href: '/backoffice/settings/receipts', label: t('settings.receipts_title') },
        { href: '/backoffice/settings/documents', label: t('settings.documents_title') },
      ]}
    />
  )
}
