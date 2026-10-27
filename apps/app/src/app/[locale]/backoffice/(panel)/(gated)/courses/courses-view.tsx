'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { CourseRow } from '@/lib/backoffice/types'
import {
  Card,
  EmptyState,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { Link, useRouter } from '@/i18n/navigation'
import { NewCourseForm } from './new-course-form'
import { landingKeyHolders } from './landing-key-field'
import { LANDING_COURSE_KEYS } from '@ooc/domain/landing-course-keys'

/**
 * The catalog, folded by language like the class group list — the two screens
 * are read the same way and there is no reason for them to disagree. With ~10
 * languages over a handful of courses each, a flat list is mostly dividers:
 * closed, the first thing on screen is the language you came for.
 *
 * Changing a course changes every class group opened from it afterwards, never
 * the ones already running: a student enrolled under a rule keeps that rule,
 * the same reasoning that freezes the price version at enrollment (CLAUDE.md
 * §5). The course page says so where the change is made.
 */
export function CoursesView({
  rows,
  canCreate,
}: {
  rows: CourseRow[]
  canCreate: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()

  const courses = rows
  const [query, setQuery] = useState('')
  /**
   * Language groups the user opened. The catalog opens whole, unlike the class
   * group list: a language holds a handful of courses, not a year of groups,
   * so closing it by default would hide the whole screen to save nothing.
   */
  const [opened, setOpened] = useState<string[]>(() => [
    ...new Set(rows.map((row) => row.language.id)),
  ])
  /**
   * A language that first shows up after a refresh (a course created in a new
   * language) opens too, or the course just created would sit behind a closed
   * fold. Languages the user already saw keep whatever state they left them in.
   */
  const knownLanguages = useRef(new Set(rows.map((row) => row.language.id)))
  useEffect(() => {
    const fresh = [...new Set(rows.map((row) => row.language.id))].filter(
      (id) => !knownLanguages.current.has(id),
    )
    if (fresh.length === 0) return
    fresh.forEach((id) => knownLanguages.current.add(id))
    setOpened((current) => [...current, ...fresh])
  }, [rows])
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const searching = query.trim().length > 0

  /**
   * Landing pages whose enroll button finds no live course (OOC-117) — the
   * checkout still opens, with nothing chosen, so nobody would notice
   * otherwise. Shown to whoever can fix it.
   */
  /** The languages already in use — the hint under the language field names them. */
  const languages = useMemo(
    () => [...new Map(courses.map((row) => [row.language.id, row.language])).values()],
    [courses],
  )

  const unlinkedPages = useMemo(() => {
    const holders = landingKeyHolders(courses)
    return LANDING_COURSE_KEYS.filter((key) => !holders.has(key))
  }, [courses])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return courses
    return courses.filter((row) =>
      [row.name, row.language.name, row.level].join(' ').toLowerCase().includes(needle),
    )
  }, [courses, query])

  const byLanguage = useMemo(() => {
    const map = new Map<string, { id: string; name: string; courses: CourseRow[] }>()
    for (const row of filtered) {
      const entry =
        map.get(row.language.id) ??
        { id: row.language.id, name: row.language.name, courses: [] }
      entry.courses.push(row)
      map.set(row.language.id, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const allOpen = byLanguage.length > 0 && opened.length >= byLanguage.length

  function toggleAll() {
    setOpened(allOpen ? [] : byLanguage.map((entry) => entry.id))
  }

  function toggleLanguage(id: string) {
    setOpened((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function rowProps(course: CourseRow) {
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        router.push(`/backoffice/courses/${course.id}`)
      },
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Toolbar>
        <label className={toolbarSearchClass}>
          <span className="sr-only">{t('courses.search_label')}</span>
          <BoIcon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('courses.search_placeholder')}
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
          />
        </label>

        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep lg:ml-auto"
          >
            <BoIcon name="plus" size={16} />
            {t('courses.new_course')}
          </button>
        )}
      </Toolbar>

      {canCreate && unlinkedPages.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{t('landing_key.unlinked_title')}: </span>
            {unlinkedPages.map((key) => t(`landing_key.pages.${key}`)).join(' · ')}
            <span className="mt-1 block text-xs text-amber-800">{t('landing_key.unlinked_body')}</span>
          </span>
        </p>
      )}

      {creating && (
        <NewCourseForm
          courses={courses}
          languages={languages}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setQuery('')
            setToast(t('courses.created'))
            router.refresh()
          }}
        />
      )}

      {byLanguage.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={query ? 'search' : 'courses'}
            title={t(query ? 'courses.empty_search_title' : 'courses.empty_title')}
            body={t(query ? 'courses.empty_search_body' : 'courses.empty_body')}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-sm text-muted-foreground">
              {t('courses.course_count', { count: filtered.length })}
            </span>
            {/* Hidden while searching: with the result already open, the
                control would toggle a state nothing on screen reflects. */}
            {!searching && byLanguage.length > 1 && (
              <button
                type="button"
                onClick={toggleAll}
                className="ml-auto text-xs font-semibold text-muted-foreground transition hover:text-brand-blue"
              >
                {t(allOpen ? 'courses.collapse_all' : 'courses.expand_all')}
              </button>
            )}
          </div>

          <Card>
            <TableShell
              fixed
              columns={[
                t('courses.col_course'),
                t('courses.col_level'),
                t('courses.col_load'),
                t('courses.col_class_groups'),
                t('courses.col_status'),
                t('courses.plans'),
              ]}
            >
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[11%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[22%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={thClass}>{t('courses.col_course')}</th>
                  <th className={thClass}>{t('courses.col_level')}</th>
                  {/* Units live in the header, not repeated down every cell. */}
                  <th className={thClass}>{t('courses.col_load')}</th>
                  <th className={thClass}>{t('courses.col_class_groups')}</th>
                  <th className={thClass}>{t('courses.col_status')}</th>
                  <th className={thClass}>{t('courses.plans')}</th>
                </tr>
              </thead>
              {byLanguage.map((entry) => {
                /* A search that hid its own matches behind a closed fold would
                   read as no result at all. */
                const open = searching || opened.includes(entry.id)
                const classGroups = entry.courses.reduce(
                  (total, course) => total + course.classGroupCount,
                  0,
                )
                return (
                  <tbody key={entry.id}>
                    {/* Language divider doubles as the fold control. One table
                        for every language keeps the columns aligned. */}
                    <tr>
                      <td colSpan={6} className="border-y border-line bg-slate-50/80 p-0">
                        {searching ? (
                          <span className="flex w-full items-center gap-2 px-4 py-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {entry.name}
                            </span>
                            <span className="text-xs text-muted-foreground/70">
                              {t('courses.course_count', { count: entry.courses.length })}
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleLanguage(entry.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-2 px-4 py-1.5 text-left transition hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100"
                          >
                            <BoIcon
                              name="chevron-down"
                              size={14}
                              className={`text-muted-foreground transition-transform ${
                                open ? '' : '-rotate-90'
                              }`}
                            />
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {entry.name}
                            </span>
                            <span className="text-xs text-muted-foreground/70">
                              {t('courses.course_count', { count: entry.courses.length })}
                            </span>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground/70">
                              {t('courses.class_group_count', { count: classGroups })}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>

                    {open &&
                      entry.courses.map((course) => (
                        <tr key={course.id} {...rowProps(course)}>
                          <td className={tdClass}>
                            <Link
                              href={`/backoffice/courses/${course.id}`}
                              className="font-semibold text-ink transition hover:text-brand-blue"
                            >
                              {course.name}
                            </Link>
                          </td>
                          <td className={`${tdClass} text-sm text-muted-foreground`}>
                            {course.level}
                          </td>
                          <td
                            className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                          >
                            {t('courses.load_value', {
                              modules: course.modules,
                              hours: course.totalHours,
                            })}
                          </td>
                          <td
                            className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                          >
                            {course.classGroupCount}
                          </td>
                          {/* Both states read, but only the exception is worth
                              a badge: a pill worn by almost every row stops
                              carrying information. */}
                          <td className={tdClass}>
                            {course.active &&
                            (!course.hasPriceInForce || course.missingModuleMaterials) ? (
                              <span className="flex flex-wrap gap-1.5">
                                {/* In the catalog but not for sale: /enrollment
                                    only offers a course with a price in force. */}
                                {!course.hasPriceInForce && (
                                  <StatusBadge
                                    tone="warning"
                                    label={t('courses.no_price_badge')}
                                    title={t('courses.no_price_hint')}
                                  />
                                )}
                                {/* Still on sale, but a module has no material
                                    for its teacher yet (OOC-94). */}
                                {course.missingModuleMaterials && (
                                  <StatusBadge
                                    tone="warning"
                                    label={t('courses.no_material_badge')}
                                    title={t('courses.no_material_hint')}
                                  />
                                )}
                              </span>
                            ) : course.active ? (
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                {t('courses.active')}
                              </span>
                            ) : (
                              <StatusBadge
                                tone="neutral"
                                label={t('courses.inactive')}
                              />
                            )}
                          </td>
                          <td className={tdClass}>
                            <Link
                              href={`/backoffice/courses/${course.id}#plans`}
                              aria-label={`${t('courses.plans')} · ${course.name}`}
                              className={`-my-2 inline-flex min-h-tap items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm transition hover:bg-sky hover:text-brand-blue ${
                                course.planCount === 0 ? 'font-semibold text-amber-700' : 'text-muted-foreground'
                              }`}
                            >
                              <BoIcon name={course.planCount === 0 ? 'plus' : 'payments'} size={16} />
                              {course.planCount === 0
                                ? t('courses.add_plan')
                                : t('courses.plan_count', { count: course.planCount })}
                            </Link>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                )
              })}
            </TableShell>
          </Card>
        </>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
