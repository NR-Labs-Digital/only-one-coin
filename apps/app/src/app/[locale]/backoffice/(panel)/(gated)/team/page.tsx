import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listTeachers } from '@/lib/backoffice/mock-data'
import { listStaff } from '@/lib/backoffice/staff'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageStaff } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeamView } from './team-view'

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

  /* An account for a docente is opened over somebody already on the roster —
     and only over one still on it, because the account is what lets them run
     the class groups they are given. */
  const teachers = listTeachers()
    .filter((teacher) => teacher.status === 'active')
    .map((teacher) => ({
      id: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
    }))

  const rows = await listStaff()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('team.title')} />
      <TeamView
        rows={rows}
        teachers={teachers}
        currentUserId={staff.id}
        currentUserName={`${staff.firstName} ${staff.lastName}`}
      />
    </div>
  )
}
