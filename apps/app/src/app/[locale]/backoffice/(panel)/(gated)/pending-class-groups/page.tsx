import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { listPendingTeacherClassGroups } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import { canBrowseCatalog } from '@/lib/backoffice/permissions'
import type { ClassGroupItem } from '@/lib/backoffice/types'
import { Card, EmptyState, PageHeader } from '@/components/backoffice/ui'
import { AcademicTabs } from '@/components/backoffice/academic-tabs'
import {
  CLASS_GROUP_COLUMNS,
  ClassGroupTable,
  ClassGroupTableRow,
} from '../class-groups/class-group-table'

/**
 * The class groups whose seats closed with no teacher yet, every period at
 * once (OOC-97). Coordination assigns teachers after enrollment closes, so
 * this is its to-do list: a class group joins it when its seats close and
 * leaves it when a teacher is saved on it — both computed by the API on read
 * (`pendingTeacherClassGroup`), nothing stored. Assigning happens on the class
 * group's own page, where the form already lives.
 */
export default async function PendingClassGroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff.role)) notFound()
  const items = await listPendingTeacherClassGroups()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <AcademicTabs />
      {items === null ? (
        <Card className="p-4">
          <EmptyState
            icon="alert"
            title={t('class_groups.load_error_title')}
            body={t('class_groups.load_error_body')}
          />
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('class_groups.pending_intro')}</p>
          {items.length === 0 ? (
            <Card className="p-4">
              <EmptyState
                icon="check"
                title={t('class_groups.pending_empty_title')}
                body={t('class_groups.pending_empty_body')}
              />
            </Card>
          ) : (
            <Card>
              <ClassGroupTable>
                {byPeriod(items).map((period) => (
                  <tbody key={period.id}>
                    <tr>
                      <td
                        colSpan={CLASS_GROUP_COLUMNS}
                        className="border-y border-line bg-slate-50/80 px-4 py-1.5"
                      >
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {period.name}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground/70">
                          {t('class_groups.group_count', { count: period.groups.length })}
                        </span>
                      </td>
                    </tr>
                    {period.groups.map((row) => (
                      <ClassGroupTableRow key={row.id} row={row} closedBecause={closedBecause(row)} />
                    ))}
                  </tbody>
                ))}
              </ClassGroupTable>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Which of the API's conditions put the row here, for its badge. Membership is
 * the API's call; by elimination, a row that is neither in progress nor full
 * is here because its enrollment window ended.
 */
function closedBecause(row: ClassGroupItem): 'full' | 'window_closed' | undefined {
  if (row.status === 'in_progress') return undefined
  return row.seatsTaken >= row.capacity ? 'full' : 'window_closed'
}

/** Folded by sales period, the one whose classes start first on top — the most overdue. */
function byPeriod(items: ClassGroupItem[]) {
  const map = new Map<string, { id: string; name: string; firstStart: string; groups: ClassGroupItem[] }>()
  for (const row of items) {
    const entry = map.get(row.academicPeriodId) ?? {
      id: row.academicPeriodId,
      name: row.academicPeriodName,
      firstStart: row.startsOn ?? '',
      groups: [],
    }
    entry.groups.push(row)
    if (row.startsOn && (!entry.firstStart || row.startsOn < entry.firstStart)) entry.firstStart = row.startsOn
    map.set(row.academicPeriodId, entry)
  }
  return [...map.values()].sort((a, b) => a.firstStart.localeCompare(b.firstStart))
}
