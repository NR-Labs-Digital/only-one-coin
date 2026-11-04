import { normalizeOperationNumber, OperationNumberAlreadyUsedError, type OperationNumberClaim } from "@ooc/domain";
import { payments } from "@ooc/db";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The SQL mirror of `normalizeOperationNumber` — and, character for
 * character, the expression `payments_method_operation_key_idx` is built on
 * (packages/db/src/schema.ts). Change one, change all three, or the lookup
 * silently stops using the index.
 */
const operationNumberKey = sql`upper(regexp_replace(${payments.operationNumber}, '[^A-Za-z0-9]', '', 'g'))`;

/**
 * One operation pays for one enrollment, per payment method (OOC-22,
 * decision 30/09/2026). Called inside the transaction that inserts the
 * payment, right before the insert: the checkout submit and the manual
 * backoffice enrollment both go through here.
 *
 * There is no unique index to lean on yet — legacy-imported rows may already
 * repeat, so it would fail to build (the same expand/contract as the
 * students' national_id, CLAUDE.md §1). The advisory lock stands in for it:
 * two submits with the same method and number serialize on it until the
 * first one commits, so the second one's lookup sees the first one's row.
 * `pg_advisory_xact_lock` releases itself with the transaction.
 *
 * Every payment counts, whatever its status: a rejected payment's operation
 * was still spent, and a replacement receipt for the same payment is a new
 * `payment_receipts` row, not a new payment. The one exception is a rejection
 * for `illegible` (decision of 04/11/2026): nobody could read that receipt, so
 * nothing says the operation was misused, and the person who did pay has to be
 * able to send a better photo of it. The partial match below still leaves the
 * lookup on `payments_method_operation_key_idx`.
 */
export async function assertOperationNumberUnused(tx: Tx, claim: OperationNumberClaim): Promise<void> {
  const key = normalizeOperationNumber(claim.operationNumber);
  if (key === "") {
    return;
  }

  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`operation_number:${claim.method}:${key}`}, 0))`);

  const [used] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.method, claim.method),
        sql`${payments.operationNumber} is not null`,
        sql`${operationNumberKey} = ${key}`,
        sql`${payments.rejectionReason} is distinct from 'illegible'`,
      ),
    )
    .limit(1);

  if (used) {
    throw new OperationNumberAlreadyUsedError();
  }
}
