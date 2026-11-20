import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { currentPeriod } from "@/infra/persistence/catalog/currentPeriod.js";
import {
  assembleReport,
  type ClassGroupFactRow,
  type MonthFactRow,
  type Report,
  type ReportDimension,
  type ReportPeriod,
  type RunFactRow,
} from "./assembleReport.js";

export interface ReportQueryInput {
  /** A period id, `all`, or absent for the current period (`currentPeriod`). */
  period?: string;
  dimension: ReportDimension;
}

export interface ReportResult extends Report {
  /** When the figures were built; `null` = the aggregation has never run. */
  refreshedAt: Date | null;
}

/** The course's language: its row in `languages`, or the text of a course from before OOC-128. */
const LANGUAGE_KEY = sql`coalesce(l.id::text, 'text:' || lower(c.language))`;
const LANGUAGE_NAME = sql`coalesce(l.name, c.language)`;

type Numeric = number | string;

/**
 * Backs `GET /reports` (OOC-40). Reads only the nightly aggregation
 * (`ReportFactsRefresher`) — a few rows per module run — and joins the names
 * live, so a renamed course or a newly allocated teacher shows at once while
 * the counts are as of the last refresh. Never touches `enrollments` or
 * `payments`: that is what keeps the screen under two seconds at 20k
 * enrollments a month (CLAUDE.md §1).
 *
 * Retired catalog entries still label their history: a retired course or
 * period keeps the enrollments that happened in it (CLAUDE.md §1).
 */
export class ReportQuery {
  constructor(private readonly db: Db) {}

  async run(input: ReportQueryInput): Promise<ReportResult> {
    // One after the other: each read is a handful of rows, and a single
    // connection (a transaction in the tests) cannot run two at once.
    const periods = await this.periods();
    const runs = await this.runs();
    const classGroups = await this.classGroups();
    const refreshedAt = await this.refreshedAt();

    const covered = new Set([...runs.map((row) => row.periodId), ...classGroups.map((row) => row.periodId)]);
    const periodId = await this.resolvePeriod(input.period, covered, periods);
    const months = await this.months(periodId);

    return {
      ...assembleReport({ periods, runs, classGroups, months, periodId, dimension: input.dimension }),
      refreshedAt,
    };
  }

  /**
   * `all` is every period; an id outside the facts reads as an empty period
   * rather than an error (it may simply have nothing yet). Absent opens on the
   * current period, the one the institution closes against — or the newest
   * the facts cover, when the current one has nothing in them.
   */
  private async resolvePeriod(
    requested: string | undefined,
    covered: Set<string>,
    periods: ReportPeriod[],
  ): Promise<string | null> {
    if (requested === "all") return null;
    if (requested) return requested;
    const current = await currentPeriod(this.db);
    if (current && covered.has(current.id)) return current.id;
    const newest = periods
      .filter((period) => covered.has(period.id))
      .sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime())[0];
    return newest?.id ?? null;
  }

  private async periods(): Promise<ReportPeriod[]> {
    const result = await this.db.execute<{ id: string; name: string; starts_on: Date | string }>(
      sql`select id, name, starts_on from academic_periods`,
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, startsOn: new Date(row.starts_on) }));
  }

  private async runs(): Promise<RunFactRow[]> {
    const result = await this.db.execute<{
      period_id: string;
      course_id: string;
      course_name: string;
      language_key: string;
      language_name: string;
      teacher_id: string | null;
      teacher_name: string | null;
      enrollments: Numeric;
      reserved: Numeric;
      collected_cents: Numeric;
      pending_cents: Numeric;
      pending_count: Numeric;
      low_grades: Numeric;
    }>(sql`
      select
        g.academic_period_id as period_id,
        c.id as course_id,
        c.name as course_name,
        ${LANGUAGE_KEY} as language_key,
        ${LANGUAGE_NAME} as language_name,
        t.id as teacher_id,
        t.first_name || ' ' || t.last_name as teacher_name,
        f.enrollments, f.reserved, f.collected_cents, f.pending_cents, f.pending_count, f.low_grades
      from report_run_facts f
      join class_group_modules m on m.id = f.class_group_module_id
      join class_groups g on g.id = m.class_group_id
      join courses c on c.id = g.course_id
      left join languages l on l.id = c.language_id
      left join teachers t on t.id = m.teacher_id
    `);
    return result.rows.map((row) => ({
      periodId: row.period_id,
      courseId: row.course_id,
      courseName: row.course_name,
      languageKey: row.language_key,
      languageName: row.language_name,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      enrollments: Number(row.enrollments),
      reserved: Number(row.reserved),
      collectedCents: Number(row.collected_cents),
      pendingCents: Number(row.pending_cents),
      pendingCount: Number(row.pending_count),
      lowGrades: Number(row.low_grades),
    }));
  }

  private async classGroups(): Promise<ClassGroupFactRow[]> {
    const result = await this.db.execute<{
      period_id: string;
      course_id: string;
      course_name: string;
      language_key: string;
      language_name: string;
      teachers: { id: string; name: string }[] | null;
      seats_taken: Numeric;
      capacity: Numeric;
    }>(sql`
      select
        g.academic_period_id as period_id,
        c.id as course_id,
        c.name as course_name,
        ${LANGUAGE_KEY} as language_key,
        ${LANGUAGE_NAME} as language_name,
        (
          select jsonb_agg(distinct jsonb_build_object('id', run_teacher.id, 'name', run_teacher.first_name || ' ' || run_teacher.last_name))
          from class_group_modules run
          join teachers run_teacher on run_teacher.id = run.teacher_id
          where run.class_group_id = g.id and run.deleted_at is null
        ) as teachers,
        f.seats_taken,
        f.capacity
      from report_class_group_facts f
      join class_groups g on g.id = f.class_group_id
      join courses c on c.id = g.course_id
      left join languages l on l.id = c.language_id
    `);
    return result.rows.map((row) => ({
      periodId: row.period_id,
      courseId: row.course_id,
      courseName: row.course_name,
      languageKey: row.language_key,
      languageName: row.language_name,
      teachers: row.teachers ?? [],
      seatsTaken: Number(row.seats_taken),
      capacity: Number(row.capacity),
    }));
  }

  private async months(periodId: string | null): Promise<MonthFactRow[]> {
    const scope = periodId === null ? sql`true` : sql`g.academic_period_id = ${periodId}`;
    const result = await this.db.execute<{ month: string; enrollments: Numeric; collected_cents: Numeric }>(sql`
      select to_char(f.month, 'YYYY-MM') as month, sum(f.enrollments) as enrollments, sum(f.collected_cents) as collected_cents
      from report_month_facts f
      join class_group_modules m on m.id = f.class_group_module_id
      join class_groups g on g.id = m.class_group_id
      where ${scope}
      group by 1
      order by 1
    `);
    return result.rows.map((row) => ({
      month: row.month,
      enrollments: Number(row.enrollments),
      collectedCents: Number(row.collected_cents),
    }));
  }

  private async refreshedAt(): Promise<Date | null> {
    const result = await this.db.execute<{ refreshed_at: Date | string | null }>(
      sql`select max(refreshed_at) as refreshed_at from report_refreshes`,
    );
    const value = result.rows[0]?.refreshed_at;
    return value ? new Date(value) : null;
  }
}
