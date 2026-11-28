import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface ReportRefreshResult {
  refreshedAt: Date;
  durationMs: number;
}

/**
 * Rebuilds the reports' aggregation (OOC-40): `report_run_facts`,
 * `report_month_facts` and `report_class_group_facts`, plus a row in
 * `report_refreshes` saying when. Run by the `report-refresh` worker every
 * night and at boot when the last refresh is stale — never by a route: the
 * screen reads the result, so its load time does not grow with the ledger
 * (20k enrollments a month in peak season, CLAUDE.md §1).
 *
 * One transaction, delete + insert … select: a reader sees the previous
 * figures until the commit and the new ones after, never half of each. The
 * tables are derived data — nothing here is a record anybody has to keep — so
 * emptying them is the refresh, not a delete of history (CLAUDE.md §6).
 *
 * Definitions:
 *
 * - **Enrollments** are confirmed, unretired seats — the ledger's own count
 *   (OOC-55). **Reserved** are the seats still waiting for their money.
 * - **Money** is the payments that pay for an enrollment (`payment_coverage`,
 *   so a lot's items count, OOC-158), approved as collected and pending/under
 *   review as still open. A rejection is neither. A lot's amount is split
 *   among its enrollments in proportion to each one's frozen price, in whole
 *   cents, the rounding remainder going to the lot's first item — so the
 *   pieces always add back up to what the receipt said.
 * - **Month** is the Lima calendar month: an enrollment counts in the month
 *   its first payment was approved, money in the month it was approved.
 * - **Low grades** are current grades (corrections applied, OOC-102) below
 *   `platform_settings.passing_grade` as it stands at the refresh, DA
 *   included, filed under the run the grade was posted in.
 * - **Seats** are `seats_taken + seats_over` against `capacity` (OOC-155),
 *   for class groups out of draft and not retired: a draft holds no seat and
 *   a retired class group is no longer offered.
 */
export class ReportFactsRefresher {
  constructor(private readonly db: Db) {}

  async refresh(): Promise<ReportRefreshResult> {
    const started = Date.now();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`delete from report_run_facts`);
      await tx.execute(sql`delete from report_month_facts`);
      await tx.execute(sql`delete from report_class_group_facts`);

      await tx.execute(sql`
        create temporary table report_shares on commit drop as
        with coverage as (
          select
            c.payment_id,
            c.enrollment_id,
            p.enrollment_id as head_enrollment_id,
            p.status,
            p.amount_cents::bigint as amount_cents,
            p.decided_at,
            pp.amount_cents::bigint as price_cents
          from payment_coverage c
          join payments p on p.id = c.payment_id
          join enrollments e on e.id = c.enrollment_id
          join plan_prices pp on pp.id = e.plan_price_id
        ),
        split as (
          select coverage.*,
            (amount_cents * price_cents) / nullif(sum(price_cents) over (partition by payment_id), 0) as floor_cents
          from coverage
        )
        select
          payment_id,
          enrollment_id,
          status,
          decided_at,
          coalesce(floor_cents, 0)
            + case when enrollment_id = head_enrollment_id
                then amount_cents - coalesce(sum(floor_cents) over (partition by payment_id), 0)
                else 0 end as share_cents
        from split
      `);

      await tx.execute(sql`
        insert into report_run_facts
          (class_group_module_id, enrollments, reserved, collected_cents, pending_cents, pending_count, low_grades)
        with live as (
          select e.id, coalesce(e.class_group_module_id, e.class_group_id) as run_id, e.seat_status
          from enrollments e
          where e.deleted_at is null
        ),
        seats as (
          select run_id,
            count(*) filter (where seat_status = 'confirmed') as enrollments,
            count(*) filter (where seat_status = 'reserved') as reserved
          from live
          group by run_id
        ),
        money as (
          select live.run_id,
            sum(s.share_cents) filter (where s.status = 'approved') as collected_cents,
            sum(s.share_cents) filter (where s.status in ('pending', 'under_review')) as pending_cents,
            count(distinct s.enrollment_id) filter (where s.status in ('pending', 'under_review')) as pending_count
          from report_shares s
          join live on live.id = s.enrollment_id
          group by live.run_id
        ),
        low as (
          select coalesce(g.class_group_module_id, g.class_group_id) as run_id, count(*) as low_grades
          from grades g
          join current_grades cg on cg.grade_id = g.id
          join enrollments e on e.id = g.enrollment_id and e.deleted_at is null
          where cg.did_not_sit
             or cg.score < (select ps.passing_grade from platform_settings ps where ps.id)
          group by 1
        )
        select m.id,
          coalesce(seats.enrollments, 0),
          coalesce(seats.reserved, 0),
          coalesce(money.collected_cents, 0),
          coalesce(money.pending_cents, 0),
          coalesce(money.pending_count, 0),
          coalesce(low.low_grades, 0)
        from class_group_modules m
        left join seats on seats.run_id = m.id
        left join money on money.run_id = m.id
        left join low on low.run_id = m.id
        -- Demo class groups (28/11/2026) are not the school's figures.
        where (seats.run_id is not null or money.run_id is not null or low.run_id is not null)
          and not exists (select 1 from class_groups dg where dg.id = m.class_group_id and dg.is_demo)
      `);

      await tx.execute(sql`
        insert into report_month_facts (class_group_module_id, month, enrollments, collected_cents)
        with live as (
          select e.id, coalesce(e.class_group_module_id, e.class_group_id) as run_id, e.seat_status
          from enrollments e
          where e.deleted_at is null
        ),
        first_approvals as (
          select enrollment_id, min(decided_at) as approved_at
          from report_shares
          where status = 'approved'
          group by enrollment_id
        ),
        entries as (
          select live.run_id,
            date_trunc('month', fa.approved_at at time zone 'America/Lima')::date as month,
            1::bigint as enrollments,
            0::bigint as collected_cents
          from first_approvals fa
          join live on live.id = fa.enrollment_id and live.seat_status = 'confirmed'
          union all
          select live.run_id,
            date_trunc('month', s.decided_at at time zone 'America/Lima')::date,
            0,
            s.share_cents
          from report_shares s
          join live on live.id = s.enrollment_id
          where s.status = 'approved'
        )
        select entries.run_id, entries.month, sum(entries.enrollments), sum(entries.collected_cents)
        from entries
        join class_group_modules m on m.id = entries.run_id
        where not exists (select 1 from class_groups dg where dg.id = m.class_group_id and dg.is_demo)
        group by entries.run_id, entries.month
      `);

      await tx.execute(sql`
        insert into report_class_group_facts (class_group_id, seats_taken, capacity)
        select g.id, g.seats_taken + g.seats_over, g.capacity
        from class_groups g
        where g.deleted_at is null and g.status <> 'draft' and not g.is_demo
      `);

      const durationMs = Date.now() - started;
      const [row] = (
        await tx.execute<{ refreshed_at: Date | string }>(sql`
          insert into report_refreshes (duration_ms) values (${durationMs}) returning refreshed_at
        `)
      ).rows;
      return { refreshedAt: new Date(row!.refreshed_at), durationMs };
    });
  }

  /** When the figures were last built; `null` = never. */
  async lastRefreshedAt(): Promise<Date | null> {
    const [row] = (
      await this.db.execute<{ refreshed_at: Date | string | null }>(
        sql`select max(refreshed_at) as refreshed_at from report_refreshes`,
      )
    ).rows;
    return row?.refreshed_at ? new Date(row.refreshed_at) : null;
  }
}
