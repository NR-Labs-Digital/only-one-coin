import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listInvitableTeachers, listStaff, listStaffRoleChanges } from '@/lib/backoffice/staff'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canChangeStaffRole,
  canInviteStaff,
  canManageStaff,
  canManageStaffAccess,
  canRetireStaffAccount,
  canViewPermissionMatrix,
} from '@/lib/backoffice/permissions'
import { getStaffProfiles } from '@/lib/backoffice/permission-matrix-server'
import { customCargosOf } from '@/lib/backoffice/permission-matrix'
import { redirect } from '@/i18n/navigation'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeamView } from './team-view'
import { RoleChangeLog } from './role-change-log'
import { TeamTabs } from './team-tabs'

/**
 * The team: every account that opens the backoffice, the cargo it opens it
 * with, and whether it carries the second factor its cargo requires
 * (CLAUDE.md §8).
 *
 * Admin-only, and not as a screen convenience: this is the surface where a
 * cargo changes, and the anti-escalation rule gives that to `admin` alone.
 * Hiding the section from everybody else is defense in depth — the check that
 * counts is the role declared on the route in `apps/api`, and the write itself
 * is a dedicated promotion usecase behind fresh re-authentication, never a
 * PATCH on the user row.
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* The analyst reads what each cargo can do (OOC-57), not the people who
     hold them: Equipo opens on that sheet for them. */
  if (!canManageStaff(staff) && canViewPermissionMatrix(staff)) {
    redirect({ href: '/backoffice/team/permissions', locale })
  }

  if (!canManageStaff(staff)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('team.title')} />
        <EmptyState
          icon="shield"
          title={t('team.locked_title')}
          body={t('team.locked_body')}
        />
      </div>
    )
  }

  const [rows, roleChanges, invitableTeachers, profiles] = await Promise.all([
    listStaff(),
    listStaffRoleChanges(),
    listInvitableTeachers(),
    // The cargos created in Equipo (OOC-183) — without the read, the selects
    // offer the board's only.
    canViewPermissionMatrix(staff) ? getStaffProfiles() : Promise.resolve(null),
  ])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('team.title')} />
      <TeamTabs active="people" showPeople showPermissions={canViewPermissionMatrix(staff)} />
      <TeamView
        rows={rows}
        invitableTeachers={invitableTeachers}
        currentUserId={staff.id}
        currentUserRole={staff.role}
        cargos={customCargosOf(profiles ?? [])}
        actions={{
          invite: canInviteStaff(staff),
          changeRole: canChangeStaffRole(staff),
          access: canManageStaffAccess(staff),
          retire: canRetireStaffAccount(staff),
        }}
        currentUserName={`${staff.firstName} ${staff.lastName}`}
      />
      <RoleChangeLog items={roleChanges} />
    </div>
  )
}
