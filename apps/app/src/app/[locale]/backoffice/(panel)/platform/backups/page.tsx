import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageFeatureFlags } from '@/lib/backoffice/permissions'
import { getBackupsOverview } from '@/lib/backoffice/backups'
import { EmptyState } from '@/components/backoffice/ui'
import { BackupsView } from './backups-view'

/**
 * Backups (OOC-153): the production backups the API deploy writes, and the
 * restores made from them into a scratch database. Production is never
 * written from here — a restore that fails any check has its database
 * dropped, and pointing production at a restored one stays a manual step
 * (docs/RESTAURAR-BACKUP.md). The layout draws the locked state; `.owners()`
 * on every route in `apps/api` is what enforces it.
 */
export default async function BackupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const staff = await getStaffSession()
  if (!canManageFeatureFlags(staff.email)) return null

  const t = await getTranslations('bo')
  const overview = await getBackupsOverview()
  if (!overview) {
    return <EmptyState icon="alert" title={t('backups.load_error_title')} body={t('backups.load_error_body')} />
  }
  return <BackupsView overview={overview} />
}
