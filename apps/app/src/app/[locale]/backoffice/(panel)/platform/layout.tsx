import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageFeatureFlags } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'

/**
 * The NR Labs area (OOC-153): what only whoever runs the platform opens —
 * Funcionalidades, the database backups and, since 28/11/2026, the text of the
 * documents the platform prints. Decided by the e-mail domain, not
 * the cargo (`isOwnerEmail`): an `admin` of the institution meets the locked
 * state. The check that counts is `.owners()` on every route in `apps/api`.
 *
 * Outside `(gated)` on purpose, like Funcionalidades always was: turning the
 * `backoffice` flag off must never lock the owners out of the switch that
 * turns it back on (apps/app/CLAUDE.md, Feature flags).
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('bo')
  const staff = await getStaffSession()

  if (!canManageFeatureFlags(staff.email)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('platform.title')} />
        <EmptyState icon="shield" title={t('platform.locked_title')} body={t('platform.locked_body')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('platform.title')} />
      <SectionTabs
        tabs={[
          { href: '/backoffice/platform/features', label: t('features.title') },
          { href: '/backoffice/platform/backups', label: t('backups.title') },
          { href: '/backoffice/platform/documents', label: t('settings.documents_title') },
        ]}
      />
      {children}
    </div>
  )
}
