import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getStaffSession } from '@/lib/backoffice/session'
import { getStaffProfiles } from '@/lib/backoffice/permission-matrix-server'
import { canManageProfiles, canManageStaff, canViewPermissionMatrix } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeamTabs } from '../team-tabs'
import { PermissionMatrixView } from './permission-matrix-view'

/**
 * The cargos and what each can do (OOC-57, OOC-183). The API builds the list
 * from the same permissions its authorization hook enforces, so the screen
 * cannot show an access the platform does not apply. Editing is
 * `team.profiles`, and only within what the editor's own cargo holds — the
 * API checks it again on every write.
 */
export default async function TeamPermissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('team.title')} />
      <TeamTabs active="permissions" showPeople={canManageStaff(staff)} />
      {profiles ? (
        <PermissionMatrixView
          profiles={profiles}
          viewerPermissions={staff.permissions}
          canManage={canManageProfiles(staff)}
        />
      ) : (
        <EmptyState icon="alert" title={t('permissions.load_error_title')} body={t('permissions.load_error_body')} />
      )}
    </div>
  )
}
