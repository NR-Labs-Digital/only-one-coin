// What the OCR read off a receipt, next to what the student declared and the
// price it is checked against — the quick look at "did the AI get it right"
// while developing (OOC-20). The review screen of the backoffice shows the
// same reading to staff; this is the terminal version.
//
// Read-only. It prints values read off receipts (personal data), so it is
// for whoever is looking on purpose — never piped into a log or a ticket.
//
// Usage:
//   pnpm --filter @ooc/api ocr:show                 # the 5 latest readings
//   pnpm --filter @ooc/api ocr:show -- --limit 20
//   pnpm --filter @ooc/api ocr:show -- <id>         # a payment id or a receipt upload id
import { enrollments, paymentReceipts, payments, planPrices, procedureRequests } from "@ooc/db";
import { paymentEnrollmentId } from "@/infra/persistence/payment/paymentOrigin.js";
import type { ReceiptExtractedField } from "@ooc/domain";
import { desc, eq, isNotNull, or, type SQL, sql } from "drizzle-orm";
import { container } from "@/container.js";

const USAGE = "usage: pnpm --filter @ooc/api ocr:show -- [<payment-or-upload-id>] [--limit N]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(args: string[]): { id: string | null; limit: number } {
  let id: string | null = null;
  let limit = 5;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") continue;
    if (arg === "--limit") {
      limit = Number(args[++i]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`--limit must be 1–100 — ${USAGE}`);
    } else if (!id && UUID.test(arg)) {
      id = arg;
    } else {
      throw new Error(USAGE);
    }
  }
  return { id, limit };
}

function money(cents: number | null | undefined): string {
  return cents == null ? "—" : `S/ ${(cents / 100).toFixed(2)}`;
}

function fieldValue(field: ReceiptExtractedField): string {
  if (field.value === null) return "—";
  switch (field.field) {
    case "amount_cents":
      return money(field.value);
    case "payment_method":
      return field.value === "other" ? `other: ${field.detail ?? ""}` : field.value;
    case "paid_at":
      // Stored in UTC; shown the way the receipt printed it.
      return field.value.length === 10
        ? `${field.value} (no time)`
        : `${new Date(field.value).toLocaleString("es-PE", { timeZone: "America/Lima" })} Lima`;
    default:
      return field.value;
  }
}

async function main(): Promise<void> {
  const { id, limit } = parseArgs(process.argv.slice(2));
  const filter: SQL | undefined = id
    ? or(eq(paymentReceipts.paymentId, id), eq(paymentReceipts.receiptUploadId, id))
    : undefined;

  const rows = await container.db
    .select({
      createdAt: paymentReceipts.createdAt,
      paymentId: paymentReceipts.paymentId,
      receiptUploadId: paymentReceipts.receiptUploadId,
      tier: paymentReceipts.tier,
      modelName: paymentReceipts.modelName,
      modelVersion: paymentReceipts.modelVersion,
      failureReason: paymentReceipts.failureReason,
      fields: paymentReceipts.extractedFields,
      declaredMethod: payments.method,
      declaredMethodDetail: payments.methodDetail,
      declaredOperation: payments.operationNumber,
      paymentStatus: payments.status,
      expectedCents: sql<number>`coalesce(${procedureRequests.amountCents}, ${planPrices.amountCents})`.mapWith(Number),
    })
    .from(paymentReceipts)
    .innerJoin(payments, eq(payments.id, paymentReceipts.paymentId))
    .leftJoin(procedureRequests, eq(procedureRequests.id, payments.procedureRequestId))
    .innerJoin(enrollments, eq(enrollments.id, paymentEnrollmentId))
    .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
    .where(filter ?? isNotNull(paymentReceipts.receiptUploadId))
    .orderBy(desc(paymentReceipts.createdAt))
    .limit(id ? 20 : limit);

  if (rows.length === 0) {
    process.stdout.write(
      id
        ? `No OCR reading for ${id} — not attached to a payment yet, not read yet, or OPENROUTER_API_KEY unset.\n`
        : "No OCR readings yet.\n",
    );
    return;
  }

  for (const row of rows) {
    process.stdout.write(
      [
        "",
        `── ${row.createdAt.toISOString()} · tier ${row.tier} · ${row.modelName ?? "?"}${row.modelVersion ? ` (${row.modelVersion})` : ""}`,
        `   payment ${row.paymentId} [${row.paymentStatus}] · upload ${row.receiptUploadId ?? "—"}`,
        "",
      ].join("\n"),
    );

    if (row.failureReason) {
      process.stdout.write(`   FAILED: ${row.failureReason} — no fields read\n`);
      continue;
    }

    const fields = (row.fields as ReceiptExtractedField[] | null) ?? [];
    const declared: Record<ReceiptExtractedField["field"], string> = {
      amount_cents: `${money(row.expectedCents)} (plan price)`,
      operation_number: row.declaredOperation ?? "—",
      payment_method:
        row.declaredMethod === "other" ? `other: ${row.declaredMethodDetail ?? ""}` : row.declaredMethod,
      payer_name: "—",
      paid_at: "—",
    };
    console.table(
      fields.map((field) => ({
        field: field.field,
        read: fieldValue(field),
        confidence: field.confidence.toFixed(2),
        "declared / expected": declared[field.field],
      })),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
