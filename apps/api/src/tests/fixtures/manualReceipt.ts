import { receiptUploads } from "@ooc/db";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * A staff account and a confirmed receipt it uploaded, unattached — what a
 * manual enrollment needs since its receipt became mandatory (OOC-146).
 * Meant for a transaction the suite rolls back. Returns what goes into
 * `CreateManualEnrollmentInput` (`actorId`, `receiptUploadId`) and into the
 * repository's `receipt`.
 */
export async function seedManualReceipt(
  tx: Db,
  userId: string,
): Promise<{ actorId: string; receiptUploadId: string; receipt: { receiptUploadId: string; uploadedBy: string } }> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role")
        values (${userId}, 'Matrícula Manual', ${`${userId}@example.com`}, true, 'enrollment_supervisor')
        on conflict ("id") do nothing`,
  );
  const [row] = await tx
    .insert(receiptUploads)
    .values({ uploadedBy: userId, objectKey: `receipts/raw/manual/${userId}-${crypto.randomUUID()}`, status: "uploaded" })
    .returning({ id: receiptUploads.id });
  if (!row) throw new Error("Insert into receipt_uploads returned no row");
  return { actorId: userId, receiptUploadId: row.id, receipt: { receiptUploadId: row.id, uploadedBy: userId } };
}
