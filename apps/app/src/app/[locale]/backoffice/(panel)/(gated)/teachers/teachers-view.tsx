'use client'

import { useEffect, useState, useTransition, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import type { CourseLanguage } from '@/lib/backoffice/types'
import type { TeacherDirectoryPage } from '@/lib/backoffice/teachers'
import {
  MIN_SEARCH_LENGTH,
  teacherDirectorySearchParams,
  type TeacherDirectoryQuery,
} from '@/lib/backoffice/teacher-directory-query'
import { countryName, flagEmoji } from '@/lib/geo'
import {
  Card,
  EmptyState,
  Pager,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { ContractBadge } from '@/components/backoffice/contract-badge'
import { BoIcon } from '@/components/backoffice/icons'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { NewTeacherForm } from './new-teacher-form'

/**
 * The roster is who can be given a class group tomorrow; the other tab is
 * everybody who used to be. Two tabs rather than a status filter because these
 * are two different jobs — allocating and looking something up — and a filter
 * chip made the second one feel like a slice of the first.
 */
type Tab = TeacherDirectoryQuery['status']

const TABS: Tab[] = ['active', 'inactive']

/** A pause in typing before the search reaches the URL — and the database. */
const SEARCH_DEBOUNCE_MS = 350

const selectClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Teacher directory (OOC-78). Tab, search, filters and pages live in the URL
 * and run in Postgres: this component only rewrites the URL, and the server
 * page fetches what it names.
 *
 * The row answers the two questions the roster is opened for: what can this
 * person teach, and are they carrying anything right now. "Free" is a filter of
 * its own rather than a state, because on-the-roster-with-no-class-group is
 * exactly who coordination is looking for when a class group needs a teacher —
 * and it reads nothing like "inactive", which is somebody who left.
 */
export function TeachersView({
  directory,
  query,
  languages,
  canCreate,
}: {
  directory: TeacherDirectoryPage
  query: TeacherDirectoryQuery
  languages: CourseLanguage[]
  canCreate: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [creating, setCreating] = useState(false)
  /** The table stays on screen, dimmed, while the next page renders. */
  const [pending, startTransition] = useTransition()

  /** Any change to the query goes back to page 1, unless it IS the page. */
  function navigate(next: Partial<TeacherDirectoryQuery>, mode: 'push' | 'replace' = 'push') {
    const search = teacherDirectorySearchParams({ ...query, page: 1, ...next }).toString()
    const href = search ? `${pathname}?${search}` : pathname
    startTransition(() => {
      router[mode](href, { scroll: false })
    })
  }

  /** Typed locally, sent after a pause; under the API's minimum it is no search yet. */
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

  const { items: pageRows, total, pageSize, counts } = directory

  /* Two of the three filters are questions about somebody who is still
     teaching. Off the roster they would filter a list on a fact that is the
     same for every row in it. */
  const onRoster = query.status === 'active'

  const activeFilters =
    (query.language ? 1 : 0) + (onRoster && query.free ? 1 : 0) + (onRoster && query.contract ? 1 : 0)
  const searching = query.q !== '' || activeFilters > 0

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(query.page, pageCount) - 1

  /**
   * The whole row opens the ficha, but the name stays a real link so keyboard,
   * screen reader and ctrl+click keep working.
   */
  function rowProps(id: string) {
    const href = `/backoffice/teachers/${id}`
    return {
      className: 'cursor-pointer transition hover:bg-sky-soft',
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        router.push(href)
      },
    }
  }

  /* Filters that mean nothing off the roster do not follow the reader there. */
  function openTab(next: Tab) {
    navigate({ status: next, free: false, contract: false })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Not `SectionTabs`: those are real routes, and these two are one list
          cut two ways — the same page, the same filters, no URL to bookmark. */}
      <nav className={tabStripClass}>
        {TABS.map((value) => {
          const active = query.status === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => openTab(value)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              {t(value === 'active' ? 'teachers.tab_roster' : 'teachers.tab_inactive')}
              <span className={active ? 'text-brand-blue/60' : 'text-slate-400'}>
                {counts[value]}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <label className={toolbarSearchClass}>
            <span className="sr-only">{t('teachers.search_label')}</span>
            <BoIcon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('teachers.search_placeholder')}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>

          <FiltersDropdown
            label={t('teachers.filters')}
            count={activeFilters}
            panelClassName="flex-wrap items-center gap-1.5"
          >
            {onRoster && (
            <button
              type="button"
              onClick={() => navigate({ free: !query.free })}
              aria-pressed={query.free}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                query.free
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('teachers.filter_free')}
              <span className={query.free ? 'text-white/70' : 'text-slate-400'}>
                {counts.free}
              </span>
            </button>
            )}

            {onRoster && (
            <button
              type="button"
              onClick={() => navigate({ contract: !query.contract })}
              aria-pressed={query.contract}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                query.contract
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('teachers.filter_contract')}
              <span className={query.contract ? 'text-white/70' : 'text-slate-400'}>
                {counts.contract}
              </span>
            </button>
            )}

            {onRoster && <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />}

            <label className="flex items-center gap-2">
              <span className="sr-only">{t('teachers.filter_language')}</span>
              <select
                value={query.language ?? ''}
                onChange={(event) => navigate({ language: event.target.value || null })}
                className={selectClass}
              >
                <option value="">{t('teachers.filter_language')}</option>
                {languages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </FiltersDropdown>

          {canCreate && !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep lg:ml-auto"
            >
              <BoIcon name="plus" size={16} />
              {t('teachers.new')}
            </button>
          )}
        </Toolbar>

      </div>

      {creating && (
        <NewTeacherForm
          languages={languages}
          onCancel={() => setCreating(false)}
          onCreate={(teacherId) => {
            setCreating(false)
            // The new file opens straight away: it is read from the server like
            // every other, and its own page is where it is checked next.
            router.push(`/backoffice/teachers/${teacherId}`)
          }}
        />
      )}

      <Card className={`min-w-0 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={searching ? 'search' : 'teachers'}
              title={t(
                !searching && !onRoster
                  ? 'teachers.empty_inactive_title'
                  : 'teachers.empty_title',
              )}
              body={t(
                !searching && !onRoster
                  ? 'teachers.empty_inactive_body'
                  : 'teachers.empty_body',
              )}
            />
          </div>
        ) : (
          <>
            <TableShell
              /* A última coluna só existe no quadro ativo, e a lista do
                 celular lê os rótulos por posição — se ela entrasse aqui
                 sempre, fora do quadro a etiqueta de "Contrato" cairia na
                 célula errada. */
              columns={[
                t('teachers.col_teacher'),
                t('teachers.col_languages'),
                t('teachers.col_class_groups'),
                ...(onRoster ? [t('teachers.col_contract')] : []),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('teachers.col_teacher')}</th>
                  <th className={thClass}>{t('teachers.col_languages')}</th>
                  <th className={`${thClass} text-right`}>
                    {t('teachers.col_class_groups')}
                  </th>
                  {/* The contract is a question about somebody who is still
                      teaching; off the roster every row answers it the same
                      way. */}
                  {onRoster && (
                    <th className={thClass}>{t('teachers.col_contract')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} {...rowProps(row.id)}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <Link
                        href={`/backoffice/teachers/${row.id}`}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {`${row.firstName} ${row.lastName}`}
                      </Link>
                      {/* Origin is on the row, not only in the ficha: the
                          catalog sells the Italian class group on its
                          "docente ítalo-peruano" (`docs/REGRAS-NEGOCIO.md`
                          §3), so it is what one teacher is told from another
                          by when the class group is being advertised. */}
                      <p className="text-xs text-muted-foreground">
                        {`${flagEmoji(row.nationality)} ${countryName(row.nationality, locale)}`}
                      </p>
                    </td>
                    <td className={tdClass}>
                      <span className="flex flex-wrap gap-1">
                        {row.languages.map((item) => (
                          <span
                            key={item.id}
                            className="whitespace-nowrap rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep"
                          >
                            {item.name}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td
                      className={`${tdClass} text-right text-sm font-semibold tabular-nums text-ink`}
                    >
                      {row.activeClassGroups > 0 ? (
                        row.activeClassGroups
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {t('teachers.free')}
                        </span>
                      )}
                    </td>
                    {/* The contract sits on the row, not only in the ficha:
                        a teacher running a class group on a lapsed contract is
                        the institution's exposure, and nobody opens twelve
                        fichas to find out. Off the roster there is nothing to
                        watch — the tab already said so. */}
                    {onRoster && (
                      <td className={tdClass}>
                        <ContractBadge
                          contract={row.contract}
                          daysLeft={row.contractDaysLeft}
                          alertDays={directory.contractAlertDays}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableShell>

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('teachers.page_status', {
                  from: currentPage * pageSize + 1,
                  to: currentPage * pageSize + pageRows.length,
                  total,
                })}
                prevLabel={t('teachers.page_prev')}
                nextLabel={t('teachers.page_next')}
                onChange={(page) => navigate({ page: page + 1 })}
              />
            )}
          </>
        )}
      </Card>
    </div>
  )
}
