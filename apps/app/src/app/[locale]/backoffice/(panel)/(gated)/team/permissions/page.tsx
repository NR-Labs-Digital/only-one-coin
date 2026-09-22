import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageStaff } from '@/lib/backoffice/permissions'
import { listCapabilities } from '@/lib/backoffice/role-permissions'
import { MATRIX_ROLES } from '@/lib/backoffice/capabilities'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { PermissionsView } from './permissions-view'

/**
 * What each cargo opens — read by cargo, changed by cargo.
 *
 * The pair of the team directory: there the account is given a cargo, here the
 * cargo is given its doors. Until this screen existed the second half was a
 * list of roles typed into a function, so widening `sales` by one screen was a
 * commit and a deploy — the same thing Funcionalidades stopped being for
 * sections of the platform (CLAUDE.md §5).
 *
 * Admin-only, and not as a screen convenience: whoever moves this matrix moves
 * what every other account in the house can reach, so it sits behind the same
 * gate as the directory where a cargo changes (CLAUDE.md §8). Hiding it from
 * everybody else is defense in depth — the check that counts is the role
 * declared on the route in `apps/api`.
 */
export default async function TeamPermissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  if (!canManageStaff(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('permissions.title')} />
        <EmptyState
          icon="shield"
          title={t('permissions.locked_title')}
          body={t('permissions.locked_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('permissions.title')}
        actions={
          <Link
            href="/backoffice/team"
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            <BoIcon name="staff" size={16} />
            {t('permissions.back_to_team')}
          </Link>
        }
      />
      <PermissionsView rows={listCapabilities()} roles={[...MATRIX_ROLES]} />
    </div>
  )
}
