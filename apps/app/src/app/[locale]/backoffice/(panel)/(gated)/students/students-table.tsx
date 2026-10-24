'use client'

import { useEffect, useState, useTransition, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import type { StudentDirectoryPage } from '@/lib/backoffice/students'
import {
  MIN_SEARCH_LENGTH,
  STUDENT_DIRECTORY_TABS,
  studentDirectorySearchParams,
  type StudentDirectoryQuery,
  type StudentDirectoryTab,
} from '@/lib/backoffice/student-directory-query'
import {
  Card,
  EmptyState,
  Pager,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { downloadBlob } from '@/lib/backoffice/csv'
import { studentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { ListStateTabs } from '@/components/backoffice/list-state-tabs'
import { NewStudentForm } from './new-student-form'

/** A pause in typing before the search reaches the URL — and the database. */
const SEARCH_DEBOUNCE_MS = 350

/**
 * Student list (OOC-76). It opens on the active tab (OOC-116): who studies
 * now. Former students and files with no enrollment are one tab away, never
 * gone. Search, the tab, the minors filter and the pages all live in the URL and run in Postgres: this component only rewrites
 * the URL, and the server component fetches exactly the page asked for. With
 * 30k students a filter applied in the browser over the loaded rows only
 * found whoever happened to be on the page — the reason this moved.
 *
 * The row carries only what tells one student from another — name, document,
 * state, load. Contact, place, age and enrollment history live one click away
 * in the ficha.
 */
export function StudentsTable({
  directory,
  query,
  canCreate,
  canExport,
}: {
  directory: StudentDirectoryPage
  query: StudentDirectoryQuery
  canCreate: boolean
  canExport: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  /**
   * True while the server renders the page just asked for. The table stays
   * on screen, dimmed, instead of blanking: the rows being replaced are still
   * the best answer until the new ones arrive.
   */
  const [pending, startTransition] = useTransition()

  /** Any change to the query goes back to page 1, unless it IS the page. */
  function navigate(next: Partial<StudentDirectoryQuery>, mode: 'push' | 'replace' = 'push') {
    const search = studentDirectorySearchParams({ ...query, page: 1, ...next }).toString()
    const href = search ? `${pathname}?${search}` : pathname
    startTransition(() => {
      router[mode](href, { scroll: false })
    })
  }

  /**
   * The search box is typed into locally and reaches the URL after a pause.
   * Under the API's minimum length it is not a search yet, so nothing is sent.
   */
  const [searchText, setSearchText] = useState(query.q)
  useEffect(() => {
    const needle = searchText.trim()
    if (needle === query.q) return
    if (needle.length > 0 && needle.length < MIN_SEARCH_LENGTH) return

    const timer = setTimeout(() => navigate({ q: needle }, 'replace'), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `navigate` closes over `query`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, query])

  /**
   * The export (OOC-121) is what the URL says the screen shows — tab, search,
   * age filter — every page, written by the server. Not the loaded rows: a
   * page is 15 of 30k. A search still being typed has not reached the URL,
   * so the file follows the list on screen, not the box.
   */
  async function exportDirectory() {
    setExporting(true)
    try {
      const search = studentDirectorySearchParams({ ...query, page: 1 })
      search.set('locale', locale)
      const response = await fetch(`/api/backoffice/students/export?${search}`)
      if (!response.ok) {
        setToast(
          response.status === 403
            ? t('student_export.error_forbidden')
            : response.status === 429
              ? t('student_export.error_rate_limited')
              : t('student_export.error_generic'),
        )
        return
      }
      const count = Number(response.headers.get('x-row-count'))
      const blob = await response.blob()
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
      downloadBlob(t('student_export.file_name', { date: today }), blob)
      if (Number.isFinite(count)) setToast(t('student_export.done', { count }))
    } catch {
      setToast(t('student_export.error_generic'))
    } finally {
      setExporting(false)
    }
  }

  const { items: pageRows, total, pageSize, counts } = directory
  const activeFilters = query.minor ? 1 : 0
  const tabCount: Record<StudentDirectoryTab, number> = {
    active: counts.active,
    former: counts.former,
    no_enrollment: counts.noEnrollment,
    all: counts.all,
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(query.page, pageCount) - 1

  /**
   * The whole row opens the ficha, but the name stays a real link in the first
   * cell so the keyboard, the screen reader and ctrl+click keep working — the
   * row handler only covers the mouse, and steps aside when the click already
   * landed on the link.
   */
  function rowProps(id: string) {
    const href = `/backoffice/students/${id}`
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        router.push(href)
      },
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* The counters come from the server, over the search alone. */}
        <ListStateTabs
          label={t('students.tabs_label')}
          active={query.status}
          onSelect={(status) => navigate({ status })}
          tabs={STUDENT_DIRECTORY_TABS.map((tab) => ({
            key: tab,
            label: t(`students.tab_${tab}`),
            count: tabCount[tab],
          }))}
        />
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('students.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('students.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          <FiltersDropdown
            label={t('students.filters')}
            count={activeFilters}
            panelClassName="flex-wrap items-center gap-1.5"
          >
            {/* Age is a filter of its own, across the tabs (OOC-116). */}
            <button
              type="button"
              onClick={() => navigate({ minor: !query.minor })}
              aria-pressed={query.minor}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                query.minor
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('students.minor')}
              <span className={query.minor ? 'text-white/70' : 'text-slate-400'}>
                {counts.minors}
              </span>
            </button>
          </FiltersDropdown>

          {/* The exception path, not the way in: most students arrive by
              filling `/enrollment` themselves (CLAUDE.md §1). Hidden from
              whoever may not use it — the enforcing check is the role on the
              route in `apps/api` (CLAUDE.md §8). */}
          <div className="ml-auto flex items-center gap-2 self-start">
            {/* Personal data leaving in bulk: shown only to who keeps the
                file; the API enforces it, audits it and rate-limits it. */}
            {canExport && (
              <button
                type="button"
                onClick={() => void exportDirectory()}
                disabled={exporting}
                title={t('student_export.hint')}
                aria-busy={exporting}
                className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-60"
              >
                <BoIcon name="download" size={16} />
                {exporting ? t('student_export.exporting') : t('student_export.export')}
              </button>
            )}
            {canCreate && !creating && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
              >
                <BoIcon name="plus" size={16} />
                {t('students.new_student')}
              </button>
            )}
          </div>
        </Toolbar>

      </div>

      {creating && (
        <NewStudentForm
          onCancel={() => setCreating(false)}
          onCreate={() => {
            setCreating(false)
            setToast(t('new_student.created'))
            // The new file is the newest row of the no-enrollment tab —
            // registering somebody does not enroll them. Back to its first
            // page, read from the server like every other row.
            navigate({ page: 1, q: '', status: 'no_enrollment', minor: false })
            setSearchText('')
            router.refresh()
          }}
        />
      )}

      <Card className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="search"
              title={t('students.empty_title')}
              body={t(query.status === 'all' ? 'students.empty_body' : 'students.empty_tab_body')}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('students.col_student'),
                t('students.col_document'),
                t('students.col_status'),
                t('students.col_courses'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('students.col_student')}</th>
                  <th className={thClass}>{t('students.col_document')}</th>
                  <th className={thClass}>{t('students.col_status')}</th>
                  <th className={`${thClass} text-right`}>{t('students.col_courses')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} {...rowProps(row.id)}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <span className="flex items-center gap-2">
                        <Link
                          href={`/backoffice/students/${row.id}`}
                          className="font-semibold text-ink transition hover:text-brand-blue"
                        >
                          {`${row.firstName} ${row.lastName}`}
                        </Link>
                        {/* Guardian consent hangs on this one — it stays in the
                            list while everything else moved to the ficha. */}
                        {row.isMinor && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {t('students.minor')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      {t('students.document', {
                        type: t(`national_id_type.${row.nationalIdType}`),
                        number: row.nationalId,
                      })}
                    </td>
                    <td className={tdClass}>
                      <StatusBadge
                        tone={studentTone[row.status]}
                        label={t(`student_status.${row.status}`)}
                      />
                    </td>
                    <td
                      className={`${tdClass} text-right text-sm font-semibold tabular-nums text-ink`}
                    >
                      {row.activeCourses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('students.page_status', {
                  from: currentPage * pageSize + 1,
                  to: currentPage * pageSize + pageRows.length,
                  total,
                })}
                prevLabel={t('students.page_prev')}
                nextLabel={t('students.page_next')}
                onChange={(page) => navigate({ page: page + 1 })}
              />
            )}
          </>
        )}
      </Card>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
