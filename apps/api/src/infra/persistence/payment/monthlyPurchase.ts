import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Reader = Pick<Db, "execute">;

/**
 * The modules a payment bought when it is a later monthly purchase (OOC-86),
 * in order, or null for any other payment.
 *
 * "Later" is what tells the two monthly payments apart: the first purchase is
 * the enrollment's own payment — written with the enrollment, and the one
 * that confirms the seat — while a purchase from the portal comes after it
 * and only buys modules. So a payment with module rows is a later purchase
 * exactly when an older payment of the same enrollment exists.
 */
export async function laterMonthlyPurchaseModules(db: Reader, paymentId: string): Promise<number[] | null> {
  const result = await db.execute<{ module: number }>(sql`
    select pm.module
      from payment_modules pm
      join payments p on p.id = pm.payment_id
     where pm.payment_id = ${paymentId}::uuid
       and pm.enrollment_id = p.enrollment_id
       and exists (
         select 1 from payment_coverage cov
           join payments older on older.id = cov.payment_id
          where cov.enrollment_id = p.enrollment_id
            and (older.created_at, older.id) < (p.created_at, p.id)
       )
     order by pm.module, pm.attempt
  `);
  const modules = result.rows.map((row) => Number(row.module));
  return modules.length > 0 ? modules : null;
}

/**
 * The same answer as `laterMonthlyPurchaseModules`, as a correlated SQL
 * expression over the outer `payments` row, for the Payments ledger and queue:
 * the module numbers, or null for any other payment.
 */
export function laterMonthlyPurchaseModulesSql(): SQL<number[] | null> {
  return sql<number[] | null>`(
    select array_agg(lpm.module order by lpm.module, lpm.attempt)
      from payment_modules lpm
     where lpm.payment_id = "payments"."id"
       and lpm.enrollment_id = "payments"."enrollment_id"
       and exists (
         select 1 from payment_coverage lcov
           join payments lolder on lolder.id = lcov.payment_id
          where lcov.enrollment_id = "payments"."enrollment_id"
            and (lolder.created_at, lolder.id) < ("payments"."created_at", "payments"."id")
       )
  )`;
}
