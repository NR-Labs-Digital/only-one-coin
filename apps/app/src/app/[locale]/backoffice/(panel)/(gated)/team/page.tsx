import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { listTeachers } from '@/lib/backoffice/mock-data'
import { listStaff } from '@/lib/backoffice/staff'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageStaff } from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
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
      {/* The directory's other half: here an account is given a cargo, there a
          cargo is given its doors. A link rather than a section tab because
          this page already carries a tab strip of its own — two rows of the
          same tabs read as two panels (`components/backoffice/tab-strip.tsx`). */}
      <PageHeader
        title={t('team.title')}
        actions={
          <Link
            href="/backoffice/team/permissions"
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            <BoIcon name="shield" size={16} />
            {t('permissions.title')}
          </Link>
        }
      />
      <TeamView
        rows={rows}
        teachers={teachers}
        currentUserId={staff.id}
        currentUserName={`${staff.firstName} ${staff.lastName}`}
      />
    </div>
  )
}
