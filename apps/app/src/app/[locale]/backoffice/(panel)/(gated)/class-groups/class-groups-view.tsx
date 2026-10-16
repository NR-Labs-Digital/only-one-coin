'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type {
  AcademicPeriodItem,
  ClassGroupItem,
  ClassGroupStatus,
  CourseRow,
  TeacherOption,
} from '@/lib/backoffice/types'
import {
  Card,
  EmptyState,
  Pager,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { ClassGroupForm, type ClassGroupFormOutcome } from './class-group-form'
import { CLASS_GROUP_COLUMNS, ClassGroupTable, ClassGroupTableRow } from './class-group-table'

type Sort = 'newest' | 'oldest'

const ALL = 'all'

const STATUSES: ClassGroupStatus[] = ['draft', 'enrolling', 'in_progress', 'finished', 'closed']

/** Still being sold or taught — the day-to-day half of the screen. */
const ACTIVE: ReadonlySet<ClassGroupStatus> = new Set(['draft', 'enrolling', 'in_progress'])

/**
 * Closed groups only grow — a year of class groups would push the active list
 * off the screen. Ten a page keeps the section scannable.
 */
const CLOSED_PAGE_SIZE = 10

const selectClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Class group directory of one sales period (the period is picked above, in
 * `PeriodBar`, and travels in the URL): drafts, enrolling and running groups up
 * top, folded by language, and the finished ones in their own section below.
 *
 * The period already narrows the list to a few dozen rows, so search and the
 * language/status filters run in the browser over what the server sent.
 *
 * Creating writes through `apps/api` and re-reads the page — the browser never
 * builds a row it did not get from Postgres (CLAUDE.md §8).
 */
export function ClassGroupsView({
  items,
  courses,
  periods,
  teachers,
  selectedPeriodId,
  canManage,
}: {
  items: ClassGroupItem[]
  courses: CourseRow[]
  periods: AcademicPeriodItem[]
  /** The roster for the form's teacher picker; null when unreadable or not needed. */
  teachers: TeacherOption[] | null
  selectedPeriodId: string | null
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const pathname = usePathname()

  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState(ALL)
  const [status, setStatus] = useState<ClassGroupStatus | typeof ALL>(ALL)
  const [sort, setSort] = useState<Sort>('newest')
  /** Only the class groups nobody is allocated to yet (OOC-80). */
  const [unassigned, setUnassigned] = useState(false)
  /**
   * Language groups the user opened. Everything starts closed: with ~10
   * languages the open list is longer than a screen, and the first thing you
   * want is to find your language, not to scroll past the other nine.
   */
  const [opened, setOpened] = useState<string[]>([])
  const [closedPage, setClosedPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const activeCourses = courses.filter((course) => course.active)

  const languages = useMemo(
    () => [...new Set(items.map((row) => row.language))].sort((a, b) => a.localeCompare(b)),
    [items],
  )

  const activeFilters = (language !== ALL ? 1 : 0) + (status !== ALL ? 1 : 0) + (unassigned ? 1 : 0)
  /** Still being sold or taught with nobody allocated — what coordination has to resolve. */
  const unassignedCount = items.filter((row) => row.active && ACTIVE.has(row.status) && !row.teacherId).length
  const narrowed = query.trim() !== '' || activeFilters > 0

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((row) => {
      if (language !== ALL && row.language !== language) return false
      if (status !== ALL && row.status !== status) return false
      if (unassigned && row.teacherId) return false
      if (!needle) return true
      return [row.courseName, row.code, row.teacherName, row.legacyTeacherName]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [items, query, language, status, unassigned])

  /** By start date; a draft without dates goes last either way, then by code. */
  const sorted = useMemo(() => {
    const direction = sort === 'newest' ? -1 : 1
    return [...filtered].sort((a, b) => {
      if (a.startsOn !== b.startsOn) {
        if (a.startsOn === null) return 1
        if (b.startsOn === null) return -1
        return direction * a.startsOn.localeCompare(b.startsOn)
      }
      return a.code.localeCompare(b.code)
    })
  }, [filtered, sort])

  const activeByLanguage = useMemo(() => {
    const map = new Map<string, { id: string; groups: ClassGroupItem[] }>()
    for (const row of sorted) {
      if (!ACTIVE.has(row.status)) continue
      const entry = map.get(row.language) ?? { id: row.language, groups: [] }
      entry.groups.push(row)
      map.set(row.language, entry)
    }
    return [...map.values()]
      .map((entry) => ({
        ...entry,
        // Seats rolled up per language: the divider carries the number so a
        // folded language still says whether it is filling up.
        seatsTaken: entry.groups.reduce((sum, row) => sum + row.seatsTaken, 0),
        capacity: entry.groups.reduce((sum, row) => sum + row.capacity, 0),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [sorted])

  const closed = useMemo(() => sorted.filter((row) => !ACTIVE.has(row.status)), [sorted])
  const activeCount = activeByLanguage.reduce((sum, entry) => sum + entry.groups.length, 0)

  /**
   * The page is clamped instead of reset by an effect: a filter that shrinks
   * the list would otherwise leave the user staring at an empty page, and an
   * effect for that would render twice on every keystroke.
   */
  const closedPageCount = Math.max(1, Math.ceil(closed.length / CLOSED_PAGE_SIZE))
  const currentClosedPage = Math.min(closedPage, closedPageCount - 1)
  const closedPageRows = closed.slice(
    currentClosedPage * CLOSED_PAGE_SIZE,
    currentClosedPage * CLOSED_PAGE_SIZE + CLOSED_PAGE_SIZE,
  )

  const allOpen = activeByLanguage.length > 0 && opened.length >= activeByLanguage.length

  function toggleAll() {
    setOpened(allOpen ? [] : activeByLanguage.map((entry) => entry.id))
  }

  function toggleLanguage(id: string) {
    setOpened((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function clearFilters() {
    setLanguage(ALL)
    setStatus(ALL)
    setUnassigned(false)
  }

  function created(_id: string, outcome: ClassGroupFormOutcome) {
    setCreating(false)
    // A new class group hidden by the search, a filter or a closed fold would
    // read as "nothing happened". Clear the view and open its language.
    setQuery('')
    clearFilters()
    const courseLanguage = courses.find((course) => course.id === outcome.courseId)?.language.id
    if (courseLanguage) {
      setOpened((current) => (current.includes(courseLanguage) ? current : [...current, courseLanguage]))
    }
    setToast(
      t(outcome.status === 'draft' ? 'class_groups.created_draft' : 'class_groups.created_open'),
    )
    if (outcome.academicPeriodId !== selectedPeriodId) {
      router.push(`${pathname}?period=${encodeURIComponent(outcome.academicPeriodId)}`)
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <Toolbar>
        <label className={toolbarSearchClass}>
          <span className="sr-only">{t('class_groups.search_label')}</span>
          <BoIcon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('class_groups.search_placeholder')}
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
          />
        </label>

        <FiltersDropdown
          label={t('class_groups.filters')}
          count={activeFilters}
          panelClassName="flex-wrap items-end gap-3"
        >
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('class_groups.filter_language')}
            </span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className={selectClass}
            >
              <option value={ALL}>{t('class_groups.filter_all')}</option>
              {languages.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('class_groups.col_status')}
            </span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ClassGroupStatus | typeof ALL)}
              className={selectClass}
            >
              <option value={ALL}>{t('class_groups.filter_all')}</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {t(`class_group_status.${item}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-h-tap items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={unassigned}
              onChange={(event) => setUnassigned(event.target.checked)}
              className="size-4 accent-brand-blue"
            />
            {t('class_groups.filter_unassigned')}
          </label>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('class_groups.clear_filters')}
            </button>
          )}
        </FiltersDropdown>

        <button
          type="button"
          onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="sort" size={16} />
          {t(sort === 'newest' ? 'class_groups.sort_newest' : 'class_groups.sort_oldest')}
        </button>

        {canManage && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep lg:ml-auto"
          >
            <BoIcon name="plus" size={16} />
            {t('class_groups.new_class_group')}
          </button>
        )}
      </Toolbar>

      {creating &&
        (activeCourses.length === 0 ? (
          // Nothing to open a class group on: say what is missing instead of a
          // form whose first select is empty. A missing period is not this
          // case — the form creates one.
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <p className="flex flex-1 items-start gap-2 text-sm text-ink">
              <BoIcon name="alert" size={16} className="mt-0.5 shrink-0 text-amber-700" />
              {t('class_groups.no_courses')}
            </p>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="inline-flex min-h-tap items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('class_groups.cancel')}
            </button>
          </Card>
        ) : (
          <ClassGroupForm
            mode="create"
            courses={courses}
            periods={periods}
            teachers={teachers}
            defaultPeriodId={selectedPeriodId}
            onDone={created}
            onCancel={() => setCreating(false)}
          />
        ))}

      {unassignedCount > 0 && !unassigned && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <p className="flex flex-1 items-start gap-2 text-sm text-ink">
            <BoIcon name="alert" size={16} className="mt-0.5 shrink-0 text-amber-700" />
            {t('class_groups.unassigned_banner', { count: unassignedCount })}
          </p>
          <button
            type="button"
            onClick={() => setUnassigned(true)}
            className="inline-flex min-h-tap items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
          >
            {t('class_groups.unassigned_show')}
          </button>
        </Card>
      )}

      {/* Drafts, enrolling and running, folded by language */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold text-ink">{t('class_groups.active_title')}</h2>
          <span className="text-sm text-muted-foreground">
            {t('class_groups.group_count', { count: activeCount })}
          </span>
          {activeByLanguage.length > 1 && (
            <button
              type="button"
              onClick={toggleAll}
              className="ml-auto text-xs font-semibold text-muted-foreground transition hover:text-brand-blue"
            >
              {t(allOpen ? 'class_groups.collapse_all' : 'class_groups.expand_all')}
            </button>
          )}
        </div>

        {activeByLanguage.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              icon={narrowed ? 'search' : 'courses'}
              title={t(narrowed ? 'class_groups.empty_search_title' : 'class_groups.empty_active_title')}
              body={t(narrowed ? 'class_groups.empty_search_body' : 'class_groups.empty_active_body')}
            />
          </Card>
        ) : (
          <Card>
            <ClassGroupTable>
              {activeByLanguage.map((entry) => {
                /* A search that hid its own matches behind a closed fold would
                   read as no result at all. */
                const open = narrowed || opened.includes(entry.id)
                return (
                  <tbody key={entry.id}>
                    {/* Language divider doubles as the fold control. One table
                        for every language keeps the columns aligned. */}
                    <tr>
                      <td
                        colSpan={CLASS_GROUP_COLUMNS}
                        className="border-y border-line bg-slate-50/80 p-0"
                      >
                        <button
                          type="button"
                          onClick={() => toggleLanguage(entry.id)}
                          aria-expanded={open}
                          className="flex min-h-tap w-full items-center gap-2 px-4 py-1.5 text-left transition hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100"
                        >
                          <BoIcon
                            name="chevron-down"
                            size={14}
                            className={`text-muted-foreground transition-transform ${
                              open ? '' : '-rotate-90'
                            }`}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {entry.id}
                          </span>
                          <span className="text-xs text-muted-foreground/70">
                            {t('class_groups.group_count', { count: entry.groups.length })}
                          </span>
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground/70">
                            {`${entry.seatsTaken} / ${entry.capacity}`}
                          </span>
                        </button>
                      </td>
                    </tr>

                    {open && entry.groups.map((row) => <ClassGroupTableRow key={row.id} row={row} />)}
                  </tbody>
                )
              })}
            </ClassGroupTable>
          </Card>
        )}
      </section>

      {/* Finished + closed */}
      <section className="flex flex-col gap-3">
        <Card as="section">
          <details>
            <summary className="flex min-h-tap cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
              <BoIcon name="chevron-down" size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold text-ink">{t('class_groups.closed_title')}</span>
              <span className="text-xs text-muted-foreground">
                {t('class_groups.group_count', { count: closed.length })}
              </span>
            </summary>

            {closed.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon="doc"
                  title={t('class_groups.empty_closed_title')}
                  body={t('class_groups.empty_closed_body')}
                />
              </div>
            ) : (
              <>
                <ClassGroupTable>
                  <tbody>
                    {closedPageRows.map((row) => (
                      <ClassGroupTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </ClassGroupTable>

                {closedPageCount > 1 && (
                  <Pager
                    page={currentClosedPage}
                    pageCount={closedPageCount}
                    status={t('class_groups.page_status', {
                      from: currentClosedPage * CLOSED_PAGE_SIZE + 1,
                      to: currentClosedPage * CLOSED_PAGE_SIZE + closedPageRows.length,
                      total: closed.length,
                    })}
                    prevLabel={t('class_groups.page_prev')}
                    nextLabel={t('class_groups.page_next')}
                    onChange={setClosedPage}
                  />
                )}
              </>
            )}
          </details>
        </Card>
      </section>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
