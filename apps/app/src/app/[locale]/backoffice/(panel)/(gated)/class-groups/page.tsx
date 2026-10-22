import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { listClassGroupRostersFor } from '@/lib/backoffice/mock-data'
import {
  listCatalogClassGroups,
  listCatalogCourses,
  listCatalogPeriods,
  listTeacherOptions,
} from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import { getPlatformSettings } from '@/lib/backoffice/platform-settings'
import {
  canBrowseCatalog,
  canCreateClassGroup,
  isRestrictedToOwnClassGroups,
} from '@/lib/backoffice/permissions'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { ClassGroupsView } from './class-groups-view'
import { PeriodBar } from './period-bar'
import { TeacherClassGroups } from './teacher-class-groups'

/**
 * Class group directory, one sales period at a time. The period comes from the
 * URL (`?period=`), falling back to the active one, then the newest; the server
 * reads that period's class groups from the catalog API (OOC-35) and the client
 * component searches and filters over them. Hiding "new class group" or "new
 * period" is a screen convenience — the enforcing check is the role declared on
 * the route in `apps/api` (CLAUDE.md §8).
 */
export default async function ClassGroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ group?: string; period?: string }>
}) {
  const { locale } = await params
  const { group, period } = await searchParams
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
    // What "approved" means is the backoffice's (OOC-41). Without it the
    // grade sheet cannot tell pass from fail, so it says it could not load.
    const settings = await getPlatformSettings()
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('nav.my_class_groups')} />
        {settings ? (
          <TeacherClassGroups
            groups={listClassGroupRostersFor(staff)}
            teacherName={`${staff.firstName} ${staff.lastName}`}
            initialGroupId={group ?? null}
            passingGrade={settings.passingGrade}
          />
        ) : (
          <EmptyState icon="alert" title={t('settings.rules_load_error_title')} body={t('settings.rules_load_error_body')} />
        )}
      </div>
    )
  }

  if (!canBrowseCatalog(staff.role)) notFound()

  const [periods, courses] = await Promise.all([listCatalogPeriods(), listCatalogCourses()])
  // An id that is not a period (stale link, typo) falls back like no id at all,
  // instead of asking the API for a period that does not exist.
  const selectedPeriodId =
    (period && periods?.some((item) => item.id === period) ? period : null) ??
    periods?.find((item) => item.active)?.id ??
    periods?.[0]?.id ??
    null
  const items =
    periods && courses ? await listCatalogClassGroups(selectedPeriodId ?? undefined) : null
  const canManage = canCreateClassGroup(staff.role)
  // Only who opens class groups reads the roster picker (the API gates it the same way).
  const teachers = canManage ? await listTeacherOptions() : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <SectionTabs
        tabs={[
          { href: '/backoffice/class-groups', label: t('class_groups.title') },
          { href: '/backoffice/courses', label: t('courses.title') },
        ]}
      />
      {items === null || periods === null || courses === null ? (
        <Card className="p-4">
          <EmptyState
            icon="alert"
            title={t('class_groups.load_error_title')}
            body={t('class_groups.load_error_body')}
          />
        </Card>
      ) : (
        <>
          <PeriodBar periods={periods} selectedId={selectedPeriodId} canManage={canManage} />
          <ClassGroupsView
            items={items}
            courses={courses}
            periods={periods}
            teachers={teachers}
            selectedPeriodId={selectedPeriodId}
            canManage={canManage}
          />
        </>
      )}
    </div>
  )
}
