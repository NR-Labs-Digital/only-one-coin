import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listStaff, listStaffRoleChanges } from '@/lib/backoffice/staff'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageStaff } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeamView } from './team-view'
import { RoleChangeLog } from './role-change-log'

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

  if (!canManageStaff(staff.role)) {
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

  const [rows, roleChanges] = await Promise.all([listStaff(), listStaffRoleChanges()])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('team.title')} />
      <TeamView
        rows={rows}
        currentUserId={staff.id}
        currentUserName={`${staff.firstName} ${staff.lastName}`}
      />
      <RoleChangeLog items={roleChanges} />
    </div>
  )
}
