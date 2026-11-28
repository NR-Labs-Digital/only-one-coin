import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageFeatureFlags } from '@/lib/backoffice/permissions'
import { getDemoAccesses } from '@/lib/backoffice/demo-accesses'
import { EmptyState } from '@/components/backoffice/ui'
import { DemoAccessesView } from './demo-view'

/**
 * Demo accesses (28/11/2026): an account a client signs in with to see the
 * student or the teacher portal from the inside and give feedback. Every row
 * behind one is marked demo and left out of the team's lists. The layout
 * draws the locked state; `.owners()` on every route in `apps/api` is what
 * enforces it.
 */
export default async function DemoAccessesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const staff = await getStaffSession()
  if (!canManageFeatureFlags(staff.email)) return null

  const t = await getTranslations('bo')
  const overview = await getDemoAccesses()
  if (!overview) {
    return <EmptyState icon="alert" title={t('demo.load_error_title')} body={t('demo.load_error_body')} />
  }
  return <DemoAccessesView overview={overview} />
}
