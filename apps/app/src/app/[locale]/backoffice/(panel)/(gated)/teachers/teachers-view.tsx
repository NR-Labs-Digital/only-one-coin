'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { CourseLanguage, TeacherRow } from '@/lib/backoffice/types'
import { contractAlert } from '@/lib/backoffice/contract'
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
type Tab = 'roster' | 'inactive'

const ALL = 'all'

const PAGE_SIZE = 15

/** Lapsing, lapsed, or never filed — the three that are somebody's errand. */
function needsContractAttention(daysLeft: number | null): boolean {
  return contractAlert(daysLeft) !== 'valid'
}

const selectClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Teacher directory. Search, filters and paging run in the browser because the
 * dataset is mocked; against the real API this becomes a server query.
 *
 * The row answers the two questions the roster is opened for: what can this
 * person teach, and are they carrying anything right now. "Free" is a filter of
 * its own rather than a state, because on-the-roster-with-no-class-group is
 * exactly who coordination is looking for when a class group needs a teacher —
 * and it reads nothing like "inactive", which is somebody who left.
 */
export function TeachersView({
  rows,
  languages,
  canCreate,
}: {
  rows: TeacherRow[]
  languages: CourseLanguage[]
  canCreate: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const router = useRouter()

  const [created, setCreated] = useState<TeacherRow[]>([])
  const [tab, setTab] = useState<Tab>('roster')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState(ALL)
  const [freeOnly, setFreeOnly] = useState(false)
  /**
   * Contracts that need chasing — lapsing, lapsed, or never filed. One filter
   * rather than three: whoever opens it is doing the same job in all three
   * cases, and three chips for one errand is three chips nobody clicks.
   */
  const [contractOnly, setContractOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)

  const all = useMemo(() => [...created, ...rows], [created, rows])

  /** The tab is the first cut; every filter and count below reads this list. */
  const scoped = useMemo(
    () =>
      all.filter((row) =>
        tab === 'roster' ? row.status === 'active' : row.status === 'inactive',
      ),
    [all, tab],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((row) => {
      if (language !== ALL && !row.languages.some((item) => item.id === language)) {
        return false
      }
      if (freeOnly && row.activeClassGroups > 0) return false
      if (contractOnly && !needsContractAttention(row.contractDaysLeft)) return false
      if (!needle) return true
      return [
        `${row.firstName} ${row.lastName}`,
        row.email,
        row.phone,
        ...row.languages.map((item) => item.name),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [scoped, query, language, freeOnly, contractOnly])

  const counts = useMemo(
    () => ({
      roster: all.filter((row) => row.status === 'active').length,
      inactive: all.filter((row) => row.status === 'inactive').length,
    }),
    [all],
  )

  const freeCount = useMemo(
    () => scoped.filter((row) => row.activeClassGroups === 0).length,
    [scoped],
  )

  const contractCount = useMemo(
    () => scoped.filter((row) => needsContractAttention(row.contractDaysLeft)).length,
    [scoped],
  )

  /* Two of the three filters are questions about somebody who is still
     teaching. Off the roster they would filter a list on a fact that is the
     same for every row in it. */
  const onRoster = tab === 'roster'

  const activeFilters =
    (language !== ALL ? 1 : 0) +
    (onRoster && freeOnly ? 1 : 0) +
    (onRoster && contractOnly ? 1 : 0)

  /** A filter that shrinks the list can leave the page behind it. */
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  )

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

  function openTab(next: Tab) {
    setTab(next)
    setPage(0)
    // Filters that mean nothing off the roster do not follow the reader there.
    if (next !== 'roster') {
      setFreeOnly(false)
      setContractOnly(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Not `SectionTabs`: those are real routes, and these two are one list
          cut two ways — the same page, the same filters, no URL to bookmark. */}
      <nav className={tabStripClass}>
        {(['roster', 'inactive'] as Tab[]).map((value) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => openTab(value)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              {t(value === 'roster' ? 'teachers.tab_roster' : 'teachers.tab_inactive')}
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
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(0)
              }}
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
              onClick={() => {
                setFreeOnly(!freeOnly)
                setPage(0)
              }}
              aria-pressed={freeOnly}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                freeOnly
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('teachers.filter_free')}
              <span className={freeOnly ? 'text-white/70' : 'text-slate-400'}>
                {freeCount}
              </span>
            </button>
            )}

            {onRoster && (
            <button
              type="button"
              onClick={() => {
                setContractOnly(!contractOnly)
                setPage(0)
              }}
              aria-pressed={contractOnly}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                contractOnly
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
              }`}
            >
              {t('teachers.filter_contract')}
              <span className={contractOnly ? 'text-white/70' : 'text-slate-400'}>
                {contractCount}
              </span>
            </button>
            )}

            {onRoster && <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />}

            <label className="flex items-center gap-2">
              <span className="sr-only">{t('teachers.filter_language')}</span>
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value)
                  setPage(0)
                }}
                className={selectClass}
              >
                <option value={ALL}>{t('teachers.filter_language')}</option>
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
          onCreate={(teacher) => {
            setCreated((current) => [teacher, ...current])
            setCreating(false)
            setPage(0)
          }}
        />
      )}

      <Card>
        {pageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={scoped.length === 0 ? 'teachers' : 'search'}
              title={t(
                scoped.length === 0 && !onRoster
                  ? 'teachers.empty_inactive_title'
                  : 'teachers.empty_title',
              )}
              body={t(
                scoped.length === 0 && !onRoster
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
                t('teachers.col_pending'),
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
                      way. "Pendiente" stays: whoever left still owing grades or
                      certificates is exactly who must not go quiet. */}
                  <th className={thClass}>{t('teachers.col_pending')}</th>
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
                    <td className={`${tdClass} whitespace-nowrap text-xs`}>
                      <span className="flex flex-col leading-tight">
                        {row.pendingGrades > 0 && (
                          <span className="font-semibold text-amber-700">
                            {t('teachers.pending_grades', { count: row.pendingGrades })}
                          </span>
                        )}
                        {row.pendingCertificates > 0 && (
                          <span className="font-semibold text-amber-700">
                            {t('teachers.pending_certificates', {
                              count: row.pendingCertificates,
                            })}
                          </span>
                        )}
                        {row.pendingGrades === 0 && row.pendingCertificates === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
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
                  from: currentPage * PAGE_SIZE + 1,
                  to: currentPage * PAGE_SIZE + pageRows.length,
                  total: filtered.length,
                })}
                prevLabel={t('teachers.page_prev')}
                nextLabel={t('teachers.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>
    </div>
  )
}
