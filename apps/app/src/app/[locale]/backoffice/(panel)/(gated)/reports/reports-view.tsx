'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ClassGroupDetail,
  ClassGroupRow,
  EnrollmentRow,
} from '@/lib/backoffice/types'
import {
  ALL_PERIODS,
  buildRankings,
  buildReport,
  buildTrend,
  listReportPeriods,
  occupancyPct,
  RANKING_METRICS,
  type ReportDimension,
  type ReportRow,
} from '@/lib/backoffice/reports'
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneyPlain,
  formatMonth,
  type Locale,
} from '@/lib/format'
import {
  Card,
  EmptyState,
  Meter,
  StatCard,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import {
  BarSeries,
  ChartHeading,
  DonutChart,
  DONUT_SLICES,
  LineSeries,
  RankedBars,
  TrendChart,
  type DonutSlice,
  type RankedItem,
  type SeriesPoint,
  type TrendLine,
} from '@/components/backoffice/charts'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'

/** The cuts, in the order the module was promised in: course first. */
const DIMENSIONS: ReportDimension[] = ['course', 'language', 'teacher']

/** Where the screen opens — and what the filter button counts as untouched. */
const DEFAULT_DIMENSION: ReportDimension = 'course'

/**
 * Two ways of reading the same period, named after what they are: the charts,
 * and the numbers behind them. There was a third — a "summary" — but it held
 * everything except the table, which is not what a summary is; a tab whose
 * name promises less than it shows is worse than no tab.
 *
 * The filter sits above both, so switching tab is a change of medium, never a
 * change of period.
 */
const TABS = ['charts', 'detail'] as const

type Tab = (typeof TABS)[number]

/** What the table is read for, in the order it is usually read for it. */
type SortKey = 'collected' | 'enrollments' | 'occupancy' | 'name'

const SORTS: SortKey[] = ['collected', 'enrollments', 'occupancy', 'name']

const selectClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Reportes. Three cuts of the same period — by course, by language, by teacher
 * — over the enrollment ledger and the seat map.
 *
 * Money and seats sit in the same row on purpose: a course collecting well with
 * its class groups half empty and one filling up with the money still open are
 * the two findings the screen exists for, and neither shows on a single column.
 *
 * Nothing here decides anything. The row is not a link into a queue, because a
 * report that ends in a decision stops being read as a report.
 */
export function ReportsView({
  enrollments,
  classGroups,
  rosters,
}: {
  enrollments: EnrollmentRow[]
  classGroups: ClassGroupRow[]
  /** The rosters, where a grade and an administrative procedure are recorded. */
  rosters: ClassGroupDetail[]
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const periods = useMemo(
    () => listReportPeriods(enrollments, classGroups),
    [enrollments, classGroups],
  )

  /* The current ciclo is what the institution closes against, so it is where
     the screen opens — the whole history is one click away. */
  const defaultPeriod = periods[0] ?? ALL_PERIODS
  const [period, setPeriod] = useState<string>(defaultPeriod)
  const [dimension, setDimension] = useState<ReportDimension>(DEFAULT_DIMENSION)
  const [sort, setSort] = useState<SortKey>('collected')
  const [tab, setTab] = useState<Tab>('charts')

  /* What the reader moved away from the state the screen opens in — the number
     on the button, so a filter left on last week is not invisible. */
  const activeFilters =
    (period === defaultPeriod ? 0 : 1) + (dimension === DEFAULT_DIMENSION ? 0 : 1)

  const report = useMemo(
    () => buildReport(enrollments, classGroups, dimension, period),
    [enrollments, classGroups, dimension, period],
  )

  /* Always by course, whatever cut the table is on — see `buildRankings`. */
  const rankings = useMemo(
    () => buildRankings(enrollments, rosters, period),
    [enrollments, rosters, period],
  )

  /* The one chart the period filter does not scope: a single ciclo has no
     trend inside it. It follows the cut, so it stays the same subject as the
     rest of the screen, and its own line says which ciclos it covers. */
  const trend = useMemo(
    () => buildTrend(enrollments, classGroups, dimension, DONUT_SLICES),
    [enrollments, classGroups, dimension],
  )

  const labelOf = useMemo(
    () => (row: ReportRow) =>
      row.label.kind === 'name' ? row.label.name : t('reports.unknown_label'),
    [t],
  )

  const rows = useMemo(() => {
    const sorted = [...report.rows]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'collected':
          return b.collectedCents - a.collectedCents
        case 'enrollments':
          return b.enrollments - a.enrollments
        case 'occupancy':
          // No class group open is not zero occupancy — it is no answer, and
          // it sorts last instead of pretending to be the emptiest room.
          return (
            (occupancyPct(b.seatsTaken, b.capacity) ?? -1) -
            (occupancyPct(a.seatsTaken, a.capacity) ?? -1)
          )
        case 'name':
          return labelOf(a).localeCompare(labelOf(b))
      }
    })
    return sorted
  }, [report.rows, sort, labelOf])

  const { totals } = report
  const totalOccupancy = occupancyPct(totals.seatsTaken, totals.capacity)
  const periodLabel = period === ALL_PERIODS ? t('reports.period_all') : period

  const money = (cents: number) => formatMoney(cents, totals.currency, locale)

  /* The month series, twice: how many came in, and how much of it is already
     approved. Two charts and never one with two scales — the alignment of two
     axes is arbitrary, and it invents a correlation that is not in the data. */
  const monthPoints = useMemo<{ bars: SeriesPoint[]; line: SeriesPoint[] }>(() => {
    const bars: SeriesPoint[] = []
    const line: SeriesPoint[] = []
    for (const month of report.months) {
      const label = formatMonth(month.month, locale)
      const amount = formatMoney(month.collectedCents, totals.currency, locale)
      bars.push({
        key: month.month,
        label,
        value: month.enrollments,
        caption: String(month.enrollments),
        hint: t('reports.trend_month_hint', {
          month: label,
          count: month.enrollments,
          amount,
        }),
      })
      line.push({
        key: month.month,
        label,
        value: month.collectedCents,
        caption: amount,
        hint: t('reports.revenue_month_hint', { month: label, amount }),
      })
    }
    return { bars, line }
  }, [report.months, locale, t, totals.currency])

  /* The donut follows the cut: what share of the ciclo each course — or
     language, or teacher — is. Four slices and a tail, because a donut past
     that stops being read, and the table below already carries the detail. */
  const slices = useMemo<DonutSlice[]>(() => {
    const ranked = [...report.rows]
      .filter((row) => row.enrollments > 0)
      .sort((a, b) => b.enrollments - a.enrollments)
    if (ranked.length === 0) return []

    const share = (value: number) =>
      totals.enrollments === 0 ? 0 : Math.round((value / totals.enrollments) * 100)

    const head: DonutSlice[] = ranked.slice(0, DONUT_SLICES).map((row) => ({
      key: row.key,
      label: labelOf(row),
      value: row.enrollments,
      caption: String(row.enrollments),
      pct: share(row.enrollments),
      hint: t('reports.share_slice_hint', {
        label: labelOf(row),
        count: row.enrollments,
        pct: share(row.enrollments),
      }),
    }))

    const tail = ranked.slice(DONUT_SLICES)
    if (tail.length === 0) return head

    const value = tail.reduce((sum, row) => sum + row.enrollments, 0)
    const label = t('reports.share_others', { count: tail.length })
    return [
      ...head,
      {
        key: 'others',
        label,
        value,
        caption: String(value),
        pct: share(value),
        hint: t('reports.share_slice_hint', { label, count: value, pct: share(value) }),
        others: true,
      },
    ]
  }, [report.rows, totals.enrollments, labelOf, t])

  const trendLines = useMemo<TrendLine[]>(
    () =>
      trend.series.map((line) => {
        const label =
          line.label.kind === 'name' ? line.label.name : t('reports.unknown_label')
        return {
          key: line.key,
          label,
          points: line.values.map((value, index) => ({
            key: `${line.key}-${trend.periods[index]}`,
            label: trend.periods[index],
            value,
            caption: String(value),
            hint: t('reports.trend_point_hint', {
              label,
              period: trend.periods[index],
              count: value,
            }),
          })),
        }
      }),
    [trend, t],
  )

  const rankingItems = useMemo(
    () =>
      Object.fromEntries(
        RANKING_METRICS.map((metric) => [
          metric,
          rankings[metric].map<RankedItem>((course) => ({
            key: course.courseName,
            label: course.courseName,
            value: course.count,
            caption: String(course.count),
          })),
        ]),
      ) as Record<(typeof RANKING_METRICS)[number], RankedItem[]>,
    [rankings],
  )

  /**
   * The table as the reader sees it, handed to a spreadsheet. Same rows, same
   * order, same period — an export that quietly differs from the screen is
   * worse than no export.
   */
  function exportCsv() {
    const cells: string[][] = [
      [
        t(`reports.col_${dimension}`),
        t('reports.col_enrollments'),
        t('reports.col_collected'),
        t('reports.col_pending'),
        t('reports.col_seats_taken'),
        t('reports.col_capacity'),
      ],
      ...rows.map((row) => [
        labelOf(row),
        String(row.enrollments),
        formatMoneyPlain(row.collectedCents, locale),
        formatMoneyPlain(row.pendingCents, locale),
        String(row.seatsTaken),
        String(row.capacity),
      ]),
      [
        t('reports.total_row'),
        String(totals.enrollments),
        formatMoneyPlain(totals.collectedCents, locale),
        formatMoneyPlain(totals.pendingCents, locale),
        String(totals.seatsTaken),
        String(totals.capacity),
      ],
    ]
    // Semicolons, because the decimal separator of the three locales is a
    // comma in two of them — a comma-separated file opens as one column.
    const csv = cells
      .map((line) =>
        line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';'),
      )
      .join('\r\n')
    // The BOM is what makes a spreadsheet read the accents as accents.
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${t('reports.export_filename')}-${slug(periodLabel)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Scope. Behind a button, like every other list of the panel — and with
          the period spelled out beside it, because the numbers under it are all
          read "of this ciclo": a report against the wrong one is worse than one
          click too many. It sits above the cards, not above the table, because
          it scopes every number on the screen and the sorting does not. */}
      <div className="flex flex-col gap-3">
        <Toolbar>
          <FiltersDropdown
            label={t('reports.filters')}
            count={activeFilters}
            panelClassName="flex-col gap-3"
          >
            <FilterRow label={t('reports.period_label')}>
              <Chip
                active={period === ALL_PERIODS}
                onClick={() => setPeriod(ALL_PERIODS)}
                label={t('reports.period_all')}
              />
              {periods.map((name) => (
                <Chip
                  key={name}
                  active={period === name}
                  onClick={() => setPeriod(name)}
                  label={name}
                />
              ))}
            </FilterRow>
            <FilterRow label={t('reports.dimension_label')}>
              {DIMENSIONS.map((value) => (
                <Chip
                  key={value}
                  active={dimension === value}
                  onClick={() => setDimension(value)}
                  label={t(`reports.dimension_${value}`)}
                />
              ))}
            </FilterRow>
          </FiltersDropdown>
          <span className="text-sm text-muted-foreground">
            {t('reports.scope_summary', {
              period: periodLabel,
              group: t(`reports.dimension_${dimension}`),
            })}
          </span>
        </Toolbar>
      </div>

      {/* Not `SectionTabs`: those are real routes, and these two are one
          report read two ways — the same filter, the same period, no URL to
          bookmark. Same look as every other strip in the panel, though. */}
      <nav role="tablist" className={tabStripClass}>
        {TABS.map((value) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(value)}
              className={tabClass(active)}
            >
              {t(`reports.tab_${value}`)}
            </button>
          )
        })}
      </nav>

      {tab === 'charts' && (
        <>
      <AutoGrid as="section" min="15rem" gap="gap-3">
        <StatCard
          icon="enrollments"
          tone="info"
          label={t('reports.metric_enrollments')}
          value={String(totals.enrollments)}
          hint={t('reports.metric_enrollments_hint', {
            active: totals.active,
            reserved: totals.reserved,
          })}
        />
        <StatCard
          icon="payments"
          tone="success"
          label={t('reports.metric_collected')}
          value={money(totals.collectedCents)}
          hint={t('reports.metric_collected_hint')}
        />
        {/* Owed, not lost: a rejected receipt is a no, and it is not in here. */}
        <StatCard
          icon="clock"
          tone="warning"
          label={t('reports.metric_pending')}
          value={money(totals.pendingCents)}
          hint={t('reports.metric_pending_hint', { count: totals.pendingCount })}
        />
        <StatCard
          icon="seat"
          tone="neutral"
          label={t('reports.metric_occupancy')}
          value={totalOccupancy === null ? '—' : `${totalOccupancy}%`}
          hint={t('reports.metric_occupancy_hint', {
            taken: totals.seatsTaken,
            capacity: totals.capacity,
            groups: totals.classGroups,
          })}
        />
      </AutoGrid>

      {/* The three reads of the same period, side by side: how many came in
          each month, how much of it is already money, and who the ciclo is
          made of. Each chart carries one measure — never two scales on one
          plot, which is the fastest way to invent a correlation. */}
      <AutoGrid as="section" min="20rem" gap="gap-3">
        <Card className="flex flex-col gap-2 p-4">
          <ChartHeading
            title={t('reports.trend_title')}
            hint={t('reports.trend_hint')}
            hintLabel={t('reports.hint_label')}
          />
          <div className="flex flex-1 flex-col justify-end">
            {monthPoints.bars.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('reports.chart_empty')}
              </p>
            ) : (
              <BarSeries
                points={monthPoints.bars}
                formatTick={(value) => String(Math.round(value))}
              />
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-2 p-4">
          <ChartHeading
            title={t('reports.revenue_trend_title')}
            hint={t('reports.revenue_trend_hint')}
            hintLabel={t('reports.hint_label')}
          />
          <div className="flex flex-1 flex-col justify-end">
            {monthPoints.line.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('reports.chart_empty')}
              </p>
            ) : (
              <LineSeries
                points={monthPoints.line}
                formatTick={(value) =>
                  formatMoneyCompact(value, totals.currency, locale)
                }
              />
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <ChartHeading
            title={t('reports.share_title', {
              group: t(`reports.dimension_${dimension}`),
            })}
            hint={t('reports.share_hint')}
            hintLabel={t('reports.hint_label')}
          />
          <DonutChart
            slices={slices}
            total={String(totals.enrollments)}
            totalLabel={t('reports.metric_enrollments')}
            emptyLabel={t('reports.chart_empty')}
          />
        </Card>
      </AutoGrid>
      {/* The four counts, drawn. A card that spelled out the winner hid the
          only thing worth reading — the distance between first and second —
          and a ranking is a bar chart, not a sentence. */}
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col gap-3 p-4">
            <ChartHeading
              title={t('reports.trend_courses_title', {
                group: t(`reports.dimension_${dimension}`),
              })}
            />
            <TrendChart
              lines={trendLines}
              formatTick={(value) => String(Math.round(value))}
              emptyLabel={t('reports.chart_empty')}
            />
          </Card>

          {/* Wide enough for two per row rather than three and a stray: four
              rankings read as a set, and a set with one orphan below it reads
              as an accident. */}
          <AutoGrid min="26rem" gap="gap-3">
            {RANKING_METRICS.map((metric) => (
              <Card key={metric} className="flex flex-col gap-3 p-4">
                <ChartHeading
                  title={t(`reports.ranking_${metric}`)}
                  hint={t(`reports.ranking_${metric}_hint`)}
                  hintLabel={t('reports.hint_label')}
                />
                <RankedBars
                  items={rankingItems[metric]}
                  emptyLabel={t('reports.ranking_empty')}
                />
              </Card>
            ))}
          </AutoGrid>
        </div>
        </>
      )}

      {tab === 'detail' && (
        <>
      <Toolbar>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('reports.sort_label')}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className={selectClass}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`reports.sort_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto"
        >
          <BoIcon name="download" size={16} />
          {t('reports.export')}
        </button>
      </Toolbar>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon="reports"
            title={t('reports.empty_title')}
            body={t('reports.empty_body')}
          />
        ) : (
          <TableShell
            columns={[
              t(`reports.col_${dimension}`),
              t('reports.col_enrollments'),
              t('reports.col_collected'),
              t('reports.col_pending'),
              t('reports.col_occupancy'),
            ]}
          >
            <thead>
              <tr>
                <th className={thClass}>{t(`reports.col_${dimension}`)}</th>
                <th className={`${thClass} text-right`}>
                  {t('reports.col_enrollments')}
                </th>
                <th className={`${thClass} text-right`}>
                  {t('reports.col_collected')}
                </th>
                <th className={`${thClass} text-right`}>
                  {t('reports.col_pending')}
                </th>
                <th className={thClass}>{t('reports.col_occupancy')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct = occupancyPct(row.seatsTaken, row.capacity)
                return (
                  <tr key={row.key}>
                    <td className={tdClass}>
                      <span className="font-semibold">{labelOf(row)}</span>
                      {row.sublabel && (
                        <span className="block text-xs text-muted-foreground">
                          {row.sublabel}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {row.enrollments}
                      {row.reserved > 0 && (
                        <span className="block text-xs text-amber-600">
                          {t('reports.cell_reserved', { count: row.reserved })}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                      {money(row.collectedCents)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {row.pendingCents === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        money(row.pendingCents)
                      )}
                    </td>
                    <td className={`${tdClass} w-52`}>
                      {/* No class group open this period is not an empty room:
                          the cell says there is nothing to occupy. */}
                      {pct === null ? (
                        <span className="text-xs text-muted-foreground">
                          {t('reports.no_class_group')}
                        </span>
                      ) : (
                        <span className="flex flex-col gap-1.5">
                          <span className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">
                              {t('reports.seats_of', {
                                taken: row.seatsTaken,
                                capacity: row.capacity,
                              })}
                            </span>
                            <span className="font-semibold text-ink tabular-nums">
                              {`${pct}%`}
                            </span>
                          </span>
                          <Meter
                            value={row.seatsTaken}
                            max={row.capacity}
                            tone={
                              pct >= 90 ? 'success' : pct >= 50 ? 'info' : 'warning'
                            }
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-sky-soft">
                <td className={`${tdClass} font-semibold`}>
                  {t('reports.total_row')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {periodLabel}
                  </span>
                </td>
                <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                  {totals.enrollments}
                </td>
                <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                  {money(totals.collectedCents)}
                </td>
                <td className={`${tdClass} text-right font-semibold tabular-nums`}>
                  {totals.pendingCents === 0 ? '—' : money(totals.pendingCents)}
                </td>
                <td className={`${tdClass} text-xs text-muted-foreground`}>
                  {totalOccupancy === null
                    ? t('reports.no_class_group')
                    : t('reports.seats_of', {
                        taken: totals.seatsTaken,
                        capacity: totals.capacity,
                      })}
                </td>
              </tr>
            </tfoot>
          </TableShell>
        )}
      </Card>

        </>
      )}
    </div>
  )
}

/** A file name out of a period's name — data, lowercased and hyphenated. */
function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function FilterRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-brand-blue text-white'
          : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
