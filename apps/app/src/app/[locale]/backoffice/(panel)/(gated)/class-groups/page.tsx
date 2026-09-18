import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  listClassGroupRostersFor,
  listClassGroupsFor,
  listCourses,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateClassGroup,
  isRestrictedToOwnClassGroups,
} from '@/lib/backoffice/permissions'
import { PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ClassGroupsView } from './class-groups-view'
import { TeacherClassGroups } from './teacher-class-groups'

/**
 * Class group directory. The list is a client component so search, filters and
 * ordering work without a backend; the data and the role gate come from the
 * server. Hiding "new class group" from a teacher is a screen convenience —
 * the enforcing check is the role declared on the route in `apps/api`
 * (CLAUDE.md §8).
 */
export default async function ClassGroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ group?: string }>
}) {
  const { locale } = await params
  const { group } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  const restricted = isRestrictedToOwnClassGroups(staff.role)

  /* The teacher's half of the section is a different screen, not a filtered
     copy of the directory: their few turmas as tabs, and under the open tab
     the whole management of that group, student by student. The rosters come
     scoped by the session's `teacherId` (CLAUDE.md §8) — and the check that
     enforces it is the usecase in `apps/api`, not this line. */
  if (restricted) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('nav.my_class_groups')} />
        <TeacherClassGroups
          groups={listClassGroupRostersFor(staff)}
          teacherName={`${staff.firstName} ${staff.lastName}`}
          initialGroupId={group ?? null}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <SectionTabs
        tabs={[
          { href: '/backoffice/class-groups', label: t('class_groups.title') },
          { href: '/backoffice/courses', label: t('courses.title') },
        ]}
      />
      <ClassGroupsView
        rows={listClassGroupsFor(staff)}
        courses={listCourses()}
        canCreate={canCreateClassGroup(staff.role)}
      />
    </div>
  )
}
