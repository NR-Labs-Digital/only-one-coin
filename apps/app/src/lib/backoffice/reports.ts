/**
 * The reports screen's data (OOC-40), as `GET /api/v1/reports` serves it.
 *
 * Nothing is summed here any more. The numbers are built every night by
 * `apps/api` (`ReportFactsRefresher`) and read already cut — by course,
 * language or teacher — so the screen loads in the same time at 20k
 * enrollments a month as at twenty (CLAUDE.md §1). Definitions live in that
 * file; the screen only draws them.
 *
 * Paid procedures (the constancia, `docs/REGRAS-NEGOCIO.md` §5) are out: they
 * carry no class group to be reported under, and Payments already counts them.
 */

/** How the table is cut. The period is a filter, not a cut — it scopes them all. */
export type ReportDimension = 'course' | 'language' | 'teacher'

export const REPORT_DIMENSIONS: ReportDimension[] = ['course', 'language', 'teacher']

/** Every period, as a filter value. `all` is a scope, never a period's name. */
export const ALL_PERIODS = 'all'

/**
 * A row's name: catalog data shown as written (CLAUDE.md §4), or — by teacher —
 * the runs nobody was allocated to, which the locale names in words.
 */
export type ReportLabel = { kind: 'name'; name: string } | { kind: 'no_teacher' }

export interface ReportPeriod {
  id: string
  name: string
}

export interface ReportRow {
  key: string
  label: ReportLabel
  /** The language a course belongs to, under its name. */
  sublabel: string | null
  /** Confirmed seats — the ledger's own count (OOC-55). */
  enrollments: number
  /** Seats still waiting for their money. */
  reserved: number
  /** Approved money, integer cents (CLAUDE.md §6). */
  collectedCents: number
  /** Money still open — pending or under review. A rejection is not owed. */
  pendingCents: number
  /** Seats held, above capacity included (OOC-155). */
  seatsTaken: number
  capacity: number
  classGroups: number
}

export interface ReportTotals {
  enrollments: number
  reserved: number
  collectedCents: number
  pendingCents: number
  /** How many enrollments make up `pendingCents`. */
  pendingCount: number
  seatsTaken: number
  capacity: number
  classGroups: number
}

export interface ReportMonth {
  /** `2026-08` — resolved to a month name by the reader's locale. */
  month: string
  enrollments: number
  collectedCents: number
}

export interface RankedCourse {
  key: string
  name: string
  count: number
}

export interface TrendSeries {
  key: string
  label: ReportLabel
  /** One value per period, in the order of `Report.trend.periods`. */
  values: number[]
}

/**
 * The rankings the screen can answer today. Frozen and withdrawn enrollments
 * wait for the academic status of OOC-84 and are not drawn — a chart of zeros
 * would read as "nobody froze".
 */
export type RankingMetric = 'volume' | 'low_grades'

export const RANKING_METRICS: RankingMetric[] = ['volume', 'low_grades']

export interface Report {
  /** When the figures were built — ISO; `null` = the aggregation never ran. */
  refreshedAt: string | null
  /** Every period the figures cover, newest first. */
  periods: ReportPeriod[]
  /** The period on screen; `null` = the whole history. */
  periodId: string | null
  dimension: ReportDimension
  rows: ReportRow[]
  totals: ReportTotals
  /** Oldest first, the empty months in between kept. */
  months: ReportMonth[]
  /** Not scoped by the period: a single ciclo has no trend in it. */
  trend: { periods: ReportPeriod[]; series: TrendSeries[] }
  /** Always by course, whatever the cut. */
  rankings: { volume: RankedCourse[]; lowGrades: RankedCourse[] }
}

export interface ReportQuery {
  /** A period id, `all`, or `null` for the current period. */
  period: string | null
  dimension: ReportDimension
}

/** The screen's query out of the URL; anything unknown falls back to the default. */
export function parseReportQuery(search: Record<string, string | string[] | undefined>): ReportQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const period = first(search.period)?.trim() || null
  const dimension = first(search.dimension)
  return {
    period,
    dimension: REPORT_DIMENSIONS.includes(dimension as ReportDimension)
      ? (dimension as ReportDimension)
      : 'course',
  }
}

/** The query back into the URL, leaving the defaults out. */
export function reportSearchParams(query: ReportQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.period) params.set('period', query.period)
  if (query.dimension !== 'course') params.set('dimension', query.dimension)
  return params
}

/** Occupancy as a whole percentage. No class group open is not zero occupancy. */
export function occupancyPct(seatsTaken: number, capacity: number): number | null {
  if (capacity === 0) return null
  return Math.round((seatsTaken / capacity) * 100)
}
