'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { StudentRow, StudentStatus } from '@/lib/backoffice/types'
import { formatDate, type Locale } from '@/lib/format'
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
import { studentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { NewStudentForm } from './new-student-form'

type StatusFilter = StudentStatus | 'all'

const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'under_review', 'inactive']

/**
 * A screen of rows, not a scroll of them: past ~15 the eye stops scanning and
 * starts hunting, and the toolbar scrolls out of reach.
 */
const PAGE_SIZE = 15

/**
 * Student list with client-side search, status filter and paging, running
 * over whatever's currently loaded in `directory` — not the whole real
 * directory, which the server paginates (`ListStudentsQuery`, PAGE_SIZE=50)
 * rather than hand over in one query at 20k enrollments/month peak
 * (CLAUDE.md §1). "Carregar mais" fetches the next server page and appends
 * it to `directory`, so search/filter/counts below cover everything loaded
 * so far, growing as coordination scrolls — not the entire table at once.
 *
 * The row carries only what tells one student from another — name, document,
 * state, load, last activity. Contact, place, age and enrollment history live
 * one click away in the ficha: repeating them per row made every line three
 * lines tall and pushed the table off the screen.
 */
export function StudentsTable({
  rows,
  initialNextCursor,
  canCreate,
}: {
  rows: StudentRow[]
  initialNextCursor: string | null
  canCreate: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [directory, setDirectory] = useState<StudentRow[]>(rows)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  /**
   * Age is a second axis, not another status: "under review" and "minor"
   * answer different questions, and guardian consent (CLAUDE.md §1) is chased
   * across every status at once.
   */
  const [minorsOnly, setMinorsOnly] = useState(false)
  const [page, setPage] = useState(0)

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch(`/api/v1/students?cursor=${encodeURIComponent(nextCursor)}`)
      if (!response.ok) {
        setToast(t('students.load_more_error'))
        return
      }
      const nextPage = (await response.json()) as { items: StudentRow[]; nextCursor: string | null }
      setDirectory((current) => [...current, ...nextPage.items])
      setNextCursor(nextPage.nextCursor)
    } catch {
      setToast(t('students.load_more_error'))
    } finally {
      setLoadingMore(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return directory.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (minorsOnly && !row.isMinor) return false
      if (!needle) return true
      return [
        `${row.firstName} ${row.lastName}`,
        row.nationalId,
        row.email,
        row.phone,
        row.city,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [directory, query, status, minorsOnly])

  const counts = useMemo(() => {
    return {
      all: directory.length,
      active: directory.filter((r) => r.status === 'active').length,
      under_review: directory.filter((r) => r.status === 'under_review').length,
      inactive: directory.filter((r) => r.status === 'inactive').length,
    } satisfies Record<StatusFilter, number>
  }, [directory])

  const minorCount = useMemo(
    () => directory.filter((r) => r.isMinor).length,
    [directory],
  )
  const activeFilters = (status !== 'all' ? 1 : 0) + (minorsOnly ? 1 : 0)

  /** A filter or a search that shrinks the list can leave the page behind it. */
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  )

  function search(value: string) {
    setQuery(value)
    setPage(0)
  }

  function filterByStatus(value: StatusFilter) {
    setStatus(value)
    setPage(0)
  }

  function toggleMinors() {
    setMinorsOnly(!minorsOnly)
    setPage(0)
  }

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
              value={query}
              onChange={(event) => search(event.target.value)}
              placeholder={t('students.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          <FiltersDropdown
            label={t('students.filters')}
            count={activeFilters}
            panelClassName="flex-wrap items-center gap-1.5"
          >
            {STATUS_FILTERS.map((value) => {
              const active = status === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => filterByStatus(value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-brand-blue text-white'
                      : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
                  }`}
                >
                  {value === 'all' ? t('students.filter_all') : t(`student_status.${value}`)}
                  <span className={active ? 'text-white/70' : 'text-slate-400'}>
                    {counts[value]}
                  </span>
                </button>
              )
            })}

            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />

            <button
              type="button"
              onClick={toggleMinors}
              aria-pressed={minorsOnly}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                minorsOnly
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('students.minor')}
              <span className={minorsOnly ? 'text-white/70' : 'text-slate-400'}>
                {minorCount}
              </span>
            </button>
          </FiltersDropdown>

          {/* The exception path, not the way in: most students arrive by
              filling `/enrollment` themselves (CLAUDE.md §1). Hidden from
              whoever may not use it — the enforcing check is the role on the
              route in `apps/api` (CLAUDE.md §8). */}
          {canCreate && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="ml-auto inline-flex items-center gap-1.5 self-start rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
            >
              <BoIcon name="plus" size={16} />
              {t('students.new_student')}
            </button>
          )}
        </Toolbar>

      </div>

      {creating && (
        <NewStudentForm
          onCancel={() => setCreating(false)}
          onCreate={(student) => {
            setDirectory((current) => [student, ...current])
            setCreating(false)
            setPage(0)
            setToast(t('new_student.created'))
          }}
        />
      )}

      <Card>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="search"
              title={t('students.empty_title')}
              body={t('students.empty_body')}
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
                t('students.col_last_activity'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('students.col_student')}</th>
                  <th className={thClass}>{t('students.col_document')}</th>
                  <th className={thClass}>{t('students.col_status')}</th>
                  <th className={`${thClass} text-right`}>{t('students.col_courses')}</th>
                  <th className={thClass}>{t('students.col_last_activity')}</th>
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
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      {formatDate(row.lastActivityAt, locale)}
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
                  from: currentPage * PAGE_SIZE + 1,
                  to: currentPage * PAGE_SIZE + pageRows.length,
                  total: filtered.length,
                })}
                prevLabel={t('students.page_prev')}
                nextLabel={t('students.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-50"
        >
          {loadingMore ? t('students.loading_more') : t('students.load_more')}
        </button>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
