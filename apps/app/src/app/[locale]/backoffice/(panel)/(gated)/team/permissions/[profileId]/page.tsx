import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getStaffSession } from '@/lib/backoffice/session'
import { getStaffProfiles } from '@/lib/backoffice/permission-matrix-server'
import { canManageProfiles, canViewPermissionMatrix } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { RoleEditor } from './role-editor'

/**
 * One cargo: its name and what it can do (OOC-57, OOC-183). Same reading as
 * the list — the API builds it from the rules its authorization hook enforces
 * and checks every write again within the editor's own cargo.
 */
export default async function TeamRolePage({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>
}) {
  const { locale, profileId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const profilesRequest = getStaffProfiles()
  const staff = await getStaffSession()

  if (!canViewPermissionMatrix(staff)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('team.title')} />
        <EmptyState icon="shield" title={t('permissions.locked_title')} body={t('permissions.locked_body')} />
      </div>
    )
  }

  const profiles = await profilesRequest
  if (!profiles) {
    return (
      <EmptyState icon="alert" title={t('permissions.load_error_title')} body={t('permissions.load_error_body')} />
    )
  }
  const profile = profiles.find((item) => item.id === profileId)
  if (!profile) notFound()

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/team/permissions"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('permissions.back_to_roles')}
      </Link>
      <RoleEditor
        key={profile.id + profile.permissions.join(',') + (profile.name ?? '')}
        profile={profile}
        viewerPermissions={staff.permissions}
        canManage={canManageProfiles(staff)}
      />
    </div>
  )
}
