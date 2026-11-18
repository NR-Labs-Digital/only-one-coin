import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { currentPeriod } from "@/infra/persistence/catalog/currentPeriod.js";

/** The home's headline numbers, each next to the same figure for yesterday. */
export interface DashboardSummary {
  /** Enrollments whose first payment was approved today, Lima time. */
  enrollmentsToday: number;
  enrollmentsYesterday: number;
  /** People with a confirmed seat in a class group not yet finished or closed. */
  activeStudents: number;
  /** The same count as it stood at the end of yesterday, Lima time. */
  activeStudentsYesterday: number;
  /**
   * Seats held and seats offered across the current period's class groups
   * (OOC-160). `taken` counts the seats above capacity too (OOC-155), the
   * same "30 / 30 +2" Académico shows, so it can pass `capacity`.
   */
  seatOccupancy: { taken: number; capacity: number };
}

interface SummaryRow extends Record<string, unknown> {
  enrollments_today: number | string;
  enrollments_yesterday: number | string;
  active_now: number | string;
  active_yesterday: number | string;
}

/**
 * The backoffice home's figures (OOC-67), definitions decided by the owner on
 * 11/10/2026:
 *
 * - An enrollment is "of today" on the Lima day its first payment was
 *   approved — an enrollment only exists in the lists once its money is
 *   confirmed (OOC-55). The moment comes from the audit trail, the same source
 *   the Payments ledger reads its decision time from (`ListPaymentsQuery`):
 *   `payments.updated_at` moves for other reasons. First approval, so a later
 *   payment on the same enrollment never counts it again.
 * - A student is active while studying: a confirmed, unretired seat in a class
 *   group that has not reached `finished` or `closed`.
 *
 * Yesterday's active count is rebuilt from the same trail instead of a daily
 * snapshot: a seat counts once approved, a class group stops counting once it
 * advanced to `finished`/`closed`. A row with no trail (seed, legacy import)
 * is taken to have been in its current state since ever.
 *
 * One pass over every approval ever written — `payments.enrollment_id` has no
 * index, so a per-enrollment lookup would scan payments once per seat.
 */
export class DashboardSummaryQuery {
  constructor(private readonly db: Db) {}

  async run(now: Date = new Date()): Promise<DashboardSummary> {
    const at = now.toISOString();
    const result = await this.db.execute<SummaryRow>(sql`
      with bounds as (
        select
          (date_trunc('day', ${at}::timestamptz at time zone 'America/Lima') at time zone 'America/Lima') as today_start,
          ((date_trunc('day', ${at}::timestamptz at time zone 'America/Lima') - interval '1 day') at time zone 'America/Lima') as yesterday_start,
          ${at}::timestamptz as now
      ),
      first_approvals as (
        select p.enrollment_id, min(a.created_at) as approved_at
        from audit_log a
        join payments p on p.id::text = a.target_id
        where a.action = 'payment.approved'
        group by p.enrollment_id
      ),
      group_ends as (
        select g.id, g.status,
          (
            select min(a.created_at)
            from audit_log a
            where a.target_id = g.id::text
              and a.action = 'catalog.class_group.status_changed'
              and a.metadata->>'to' in ('finished', 'closed')
          ) as ended_at
        from class_groups g
      ),
      seats as (
        select e.student_id, fa.approved_at, ge.ended_at
        from enrollments e
        join group_ends ge on ge.id = e.class_group_id
        left join first_approvals fa on fa.enrollment_id = e.id
        where e.deleted_at is null
          and e.seat_status = 'confirmed'
          and not (ge.ended_at is null and ge.status in ('finished', 'closed'))
      )
      select
        (
          select count(*)
          from first_approvals fa
          join enrollments e on e.id = fa.enrollment_id and e.deleted_at is null
          where fa.approved_at >= b.today_start and fa.approved_at <= b.now
        ) as enrollments_today,
        (
          select count(*)
          from first_approvals fa
          join enrollments e on e.id = fa.enrollment_id and e.deleted_at is null
          where fa.approved_at >= b.yesterday_start and fa.approved_at < b.today_start
        ) as enrollments_yesterday,
        (
          select count(distinct s.student_id)
          from seats s
          where (s.approved_at is null or s.approved_at <= b.now)
            and (s.ended_at is null or s.ended_at > b.now)
        ) as active_now,
        (
          select count(distinct s.student_id)
          from seats s
          where (s.approved_at is null or s.approved_at < b.today_start)
            and (s.ended_at is null or s.ended_at >= b.today_start)
        ) as active_yesterday
      from bounds b
    `);

    const row = result.rows[0]!;
    return {
      seatOccupancy: await this.seatOccupancy(now),
      enrollmentsToday: Number(row.enrollments_today),
      enrollmentsYesterday: Number(row.enrollments_yesterday),
      activeStudents: Number(row.active_now),
      activeStudentsYesterday: Number(row.active_yesterday),
    };
  }

  /**
   * Summed by Postgres over the current period (the most recent one already
   * started and not retired, as the Payments and Enrollments headers), never
   * over the catalog list: that list stops at 500 class groups without a
   * period, so the figure went wrong without anyone seeing once there were
   * more (OOC-160). Only the class groups Académico rolls up as current —
   * enrolling or in progress, the "vigente" of OOC-113 — and not retired: a
   * draft holds no seat, and a finished one is not filling any more.
   */
  private async seatOccupancy(now: Date): Promise<{ taken: number; capacity: number }> {
    const period = await currentPeriod(this.db, now);
    if (!period) return { taken: 0, capacity: 0 };
    const result = await this.db.execute<{ taken: number | string; capacity: number | string }>(sql`
      select
        coalesce(sum(g.seats_taken + g.seats_over), 0) as taken,
        coalesce(sum(g.capacity), 0) as capacity
      from class_groups g
      where g.academic_period_id = ${period.id}
        and g.deleted_at is null
        and g.status in ('enrolling', 'in_progress')
    `);
    const row = result.rows[0];
    return { taken: Number(row?.taken ?? 0), capacity: Number(row?.capacity ?? 0) };
  }
}
