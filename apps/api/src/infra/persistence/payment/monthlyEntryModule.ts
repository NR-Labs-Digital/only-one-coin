import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The module a new monthly enrollment's first payment buys (OOC-86): the one
 * of the run the student enters, first attempt. Package plans and runs with
 * no module number write nothing — there is no module to buy.
 *
 * Written from the rows themselves, inside the transaction that inserts the
 * enrollments and the payment, so the checkout, the lot and the manual
 * enrollment answer it the same way and never disagree with what was saved.
 */
export async function recordMonthlyEntryModules(tx: Tx, paymentId: string, enrollmentIds: string[]): Promise<void> {
  if (enrollmentIds.length === 0) return;
  await tx.execute(sql`
    insert into payment_modules (payment_id, enrollment_id, module, attempt)
    select ${paymentId}::uuid, e.id, cgm.module, e.module_attempt
    from enrollments e
    join plan_prices pp on pp.id = e.plan_price_id
    join plans pl on pl.id = pp.plan_id and pl.billing = 'monthly'
    join class_group_modules cgm on cgm.id = coalesce(e.class_group_module_id, e.class_group_id)
    where e.id in (${sql.join(
      enrollmentIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and cgm.module is not null
  `);
}
