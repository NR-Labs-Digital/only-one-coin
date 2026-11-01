import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import {
  listCatalogClassGroups,
  listCatalogCourses,
  listCatalogPeriods,
  listPendingTeacherClassGroups,
  listTeacherOptions,
} from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseCatalog,
  canCreateClassGroup,
} from '@/lib/backoffice/permissions'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { AcademicTabs } from '@/components/backoffice/academic-tabs'
import type { AcademicPeriodItem } from '@/lib/backoffice/types'
import { ClassGroupsView } from './class-groups-view'

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
  searchParams: Promise<{ period?: string }>
}) {
  const { locale } = await params
  const { period } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  if (!canBrowseCatalog(staff.role)) notFound()

  const [periods, courses, pending] = await Promise.all([
    listCatalogPeriods(),
    listCatalogCourses(),
    listPendingTeacherClassGroups(),
  ])
  // An id that is not a period (stale link, typo) falls back like no id at all,
  // instead of asking the API for a period that does not exist.
  const selectedPeriodId =
    (period && periods?.some((item) => item.id === period) ? period : null) ??
    (periods ? defaultPeriodId(periods, new Date().toISOString()) : null)
  const items =
    periods && courses ? await listCatalogClassGroups(selectedPeriodId ?? undefined) : null
  const canManage = canCreateClassGroup(staff.role)
  // Only who opens class groups reads the roster picker (the API gates it the same way).
  const teachers = canManage ? await listTeacherOptions() : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <AcademicTabs />
      {items === null || periods === null || courses === null ? (
        <Card className="p-4">
          <EmptyState
            icon="alert"
            title={t('class_groups.load_error_title')}
            body={t('class_groups.load_error_body')}
          />
        </Card>
      ) : (
        <ClassGroupsView
            items={items}
            courses={courses}
            periods={periods}
            teachers={teachers}
            selectedPeriodId={selectedPeriodId}
            canManage={canManage}
            pendingCount={pending?.length ?? null}
          />
      )}
    </div>
  )
}

/**
 * The period the screen opens on without `?period=`: the one selling today,
 * else the next to open, else the latest that ended — retired ones last.
 * It used to be the newest period not retired, so a campaign opened ahead of
 * time (the duplicated 2027-I, all drafts) took over the screen and the
 * class groups selling right now looked gone.
 */
function defaultPeriodId(periods: AcademicPeriodItem[], now: string): string | null {
  const live = periods.filter((item) => item.active)
  const current = live.find((item) => item.startsOn <= now && now <= item.endsOn)
  const upcoming = live
    .filter((item) => item.startsOn > now)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]
  const latestEnded = live
    .filter((item) => item.endsOn < now)
    .sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0]
  return (current ?? upcoming ?? latestEnded ?? periods[0])?.id ?? null
}
