/**
 * The reports screen's figures (OOC-40), put together from last night's
 * aggregation. Pure: `ReportQuery` reads the facts with their names joined, and
 * this cuts them by course, language or teacher. The facts are a few rows per
 * module run, so the cut runs in memory in a few milliseconds whatever the
 * size of the ledger they were summed from — that work was done at night.
 */

export type ReportDimension = "course" | "language" | "teacher";

export const REPORT_DIMENSIONS = ["course", "language", "teacher"] as const satisfies readonly ReportDimension[];

/**
 * A row's name. Course, language and teacher names are catalog data, shown as
 * written (CLAUDE.md §4); a run nobody was allocated to has no name to print,
 * and the screen says so in words.
 */
export type ReportLabel = { kind: "name"; name: string } | { kind: "no_teacher" };

export interface ReportPeriod {
  id: string;
  name: string;
  startsOn: Date;
}

/** One module run's facts, with the catalog it hangs from. */
export interface RunFactRow {
  periodId: string;
  courseId: string;
  courseName: string;
  languageKey: string;
  languageName: string;
  teacherId: string | null;
  teacherName: string | null;
  enrollments: number;
  reserved: number;
  collectedCents: number;
  pendingCents: number;
  pendingCount: number;
  lowGrades: number;
}

/** One class group's seat counters, with every teacher allocated to one of its runs. */
export interface ClassGroupFactRow {
  periodId: string;
  courseId: string;
  courseName: string;
  languageKey: string;
  languageName: string;
  teachers: { id: string; name: string }[];
  seatsTaken: number;
  capacity: number;
}

export interface MonthFactRow {
  /** `2026-08`. */
  month: string;
  enrollments: number;
  collectedCents: number;
}

export interface ReportRow {
  key: string;
  label: ReportLabel;
  /** The language a course belongs to, under its name. */
  sublabel: string | null;
  enrollments: number;
  reserved: number;
  collectedCents: number;
  pendingCents: number;
  seatsTaken: number;
  capacity: number;
  classGroups: number;
}

export interface ReportTotals {
  enrollments: number;
  reserved: number;
  collectedCents: number;
  pendingCents: number;
  pendingCount: number;
  seatsTaken: number;
  capacity: number;
  classGroups: number;
}

export interface RankedCourse {
  key: string;
  name: string;
  count: number;
}

export interface TrendSeries {
  key: string;
  label: ReportLabel;
  /** One value per period, in the order of `Report.trend.periods`. */
  values: number[];
}

export interface Report {
  /** Every period the facts cover, newest first. */
  periods: { id: string; name: string }[];
  /** The period the figures are scoped to; `null` = all of them. */
  periodId: string | null;
  dimension: ReportDimension;
  rows: ReportRow[];
  totals: ReportTotals;
  /** Oldest first, the empty months in between kept: a gap is a fact. */
  months: MonthFactRow[];
  /** Not scoped by the period: a single ciclo has no trend in it. */
  trend: { periods: { id: string; name: string }[]; series: TrendSeries[] };
  /** Always by course, whatever the cut — "which course fails most" is a catalog question. */
  rankings: { volume: RankedCourse[]; lowGrades: RankedCourse[] };
}

/** How many lines the trend draws — past four a line chart stops being read. */
export const TREND_LINES = 4;

interface Keyed {
  key: string;
  label: ReportLabel;
  sublabel: string | null;
}

function runKey(row: RunFactRow, dimension: ReportDimension): Keyed {
  switch (dimension) {
    case "course":
      return { key: `course:${row.courseId}`, label: { kind: "name", name: row.courseName }, sublabel: row.languageName };
    case "language":
      return { key: `language:${row.languageKey}`, label: { kind: "name", name: row.languageName }, sublabel: null };
    case "teacher":
      return teacherKey(row.teacherId, row.teacherName);
  }
}

function teacherKey(id: string | null, name: string | null): Keyed {
  return id && name
    ? { key: `teacher:${id}`, label: { kind: "name", name }, sublabel: null }
    : { key: "teacher:none", label: { kind: "no_teacher" }, sublabel: null };
}

/**
 * The keys a class group's seats count under. By teacher, a class group counts
 * once for each teacher who runs one of its modules: its seats are the class
 * group's, not a run's (OOC-156), and splitting them would invent a number.
 * The totals count every class group once.
 */
function classGroupKeys(row: ClassGroupFactRow, dimension: ReportDimension): Keyed[] {
  switch (dimension) {
    case "course":
      return [{ key: `course:${row.courseId}`, label: { kind: "name", name: row.courseName }, sublabel: row.languageName }];
    case "language":
      return [{ key: `language:${row.languageKey}`, label: { kind: "name", name: row.languageName }, sublabel: null }];
    case "teacher":
      return row.teachers.length === 0
        ? [teacherKey(null, null)]
        : row.teachers.map((teacher) => teacherKey(teacher.id, teacher.name));
  }
}

function emptyRow({ key, label, sublabel }: Keyed): ReportRow {
  return {
    key,
    label,
    sublabel,
    enrollments: 0,
    reserved: 0,
    collectedCents: 0,
    pendingCents: 0,
    seatsTaken: 0,
    capacity: 0,
    classGroups: 0,
  };
}

/** Every month from the first to the last, so a month with nothing is a gap, not a hole. */
export function fillMonths(months: MonthFactRow[]): MonthFactRow[] {
  if (months.length === 0) return [];
  const byMonth = new Map(months.map((month) => [month.month, month]));
  const sorted = [...byMonth.keys()].sort();
  const last = sorted[sorted.length - 1]!;
  let year = Number(sorted[0]!.slice(0, 4));
  let month = Number(sorted[0]!.slice(5, 7));
  const filled: MonthFactRow[] = [];
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    filled.push(byMonth.get(key) ?? { month: key, enrollments: 0, collectedCents: 0 });
    if (key >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return filled;
}

function ranked(counts: Map<string, RankedCourse>): RankedCourse[] {
  return [...counts.values()]
    .filter((course) => course.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function assembleReport(input: {
  periods: ReportPeriod[];
  runs: RunFactRow[];
  classGroups: ClassGroupFactRow[];
  months: MonthFactRow[];
  periodId: string | null;
  dimension: ReportDimension;
}): Report {
  const { dimension, periodId } = input;
  const inScope = (id: string) => periodId === null || id === periodId;

  const covered = new Set([...input.runs.map((row) => row.periodId), ...input.classGroups.map((row) => row.periodId)]);
  const periods = input.periods.filter((period) => covered.has(period.id));
  const newestFirst = [...periods].sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime() || b.id.localeCompare(a.id));
  const oldestFirst = [...newestFirst].reverse();

  const rows = new Map<string, ReportRow>();
  const totals: ReportTotals = {
    enrollments: 0,
    reserved: 0,
    collectedCents: 0,
    pendingCents: 0,
    pendingCount: 0,
    seatsTaken: 0,
    capacity: 0,
    classGroups: 0,
  };
  const volume = new Map<string, RankedCourse>();
  const lowGrades = new Map<string, RankedCourse>();

  for (const run of input.runs) {
    if (!inScope(run.periodId)) continue;
    const keyed = runKey(run, dimension);
    const row = rows.get(keyed.key) ?? emptyRow(keyed);
    row.enrollments += run.enrollments;
    row.reserved += run.reserved;
    row.collectedCents += run.collectedCents;
    row.pendingCents += run.pendingCents;
    rows.set(keyed.key, row);

    totals.enrollments += run.enrollments;
    totals.reserved += run.reserved;
    totals.collectedCents += run.collectedCents;
    totals.pendingCents += run.pendingCents;
    totals.pendingCount += run.pendingCount;

    const course = { key: run.courseId, name: run.courseName };
    const sold = volume.get(run.courseId) ?? { ...course, count: 0 };
    sold.count += run.enrollments;
    volume.set(run.courseId, sold);
    const failed = lowGrades.get(run.courseId) ?? { ...course, count: 0 };
    failed.count += run.lowGrades;
    lowGrades.set(run.courseId, failed);
  }

  for (const group of input.classGroups) {
    if (!inScope(group.periodId)) continue;
    for (const keyed of classGroupKeys(group, dimension)) {
      const row = rows.get(keyed.key) ?? emptyRow(keyed);
      row.seatsTaken += group.seatsTaken;
      row.capacity += group.capacity;
      row.classGroups += 1;
      rows.set(keyed.key, row);
    }
    totals.seatsTaken += group.seatsTaken;
    totals.capacity += group.capacity;
    totals.classGroups += 1;
  }

  return {
    periods: newestFirst.map(({ id, name }) => ({ id, name })),
    periodId,
    dimension,
    rows: [...rows.values()],
    totals,
    months: fillMonths(input.months),
    trend: buildTrend(input.runs, oldestFirst, dimension),
    rankings: { volume: ranked(volume), lowGrades: ranked(lowGrades) },
  };
}

/** Enrollments per period for the biggest few rows of the cut, oldest period first. */
function buildTrend(
  runs: RunFactRow[],
  periods: ReportPeriod[],
  dimension: ReportDimension,
): Report["trend"] {
  const position = new Map(periods.map((period, index) => [period.id, index]));
  const series = new Map<string, TrendSeries>();
  for (const run of runs) {
    const index = position.get(run.periodId);
    if (index === undefined) continue;
    const { key, label } = runKey(run, dimension);
    const line = series.get(key) ?? { key, label, values: periods.map(() => 0) };
    line.values[index]! += run.enrollments;
    series.set(key, line);
  }
  const total = (line: TrendSeries) => line.values.reduce((sum, value) => sum + value, 0);
  return {
    periods: periods.map(({ id, name }) => ({ id, name })),
    series: [...series.values()]
      .filter((line) => total(line) > 0)
      .sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key))
      .slice(0, TREND_LINES),
  };
}
