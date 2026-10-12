import fs from "node:fs";
import path from "node:path";
import { enrollments, payments } from "@ooc/db";
import { eq } from "drizzle-orm";
import type { AppContainer } from "@/container.js";
import { assemble, type LegacyRecord } from "./assemble.js";
import { classGroupKey, ensureCatalog, resolvePlanPriceId } from "./catalog.js";
import { toCsv } from "./csv.js";
import { parseRow } from "./parse-row.js";
import { classifySheet } from "./sheet-info.js";
import { upsertStudent } from "./students.js";
import { readWorkbook } from "./workbook.js";

interface ExceptionRow {
  file: string;
  sheet: string;
  rowIndex: number;
  reason: string;
  raw: string;
}

interface RunOptions {
  dir: string;
  commit: boolean;
  outDir: string;
}

const SEAT_STATUS_BY_PAYMENT_STATUS = {
  approved: "confirmed",
  under_review: "reserved",
  rejected: "released",
} as const;

function idempotencyKeyFor(record: LegacyRecord): string {
  return `legacy:${record.sourceFile}:${record.sourceSheet}:${record.sourceRowIndex}`;
}

async function collectRecords(dir: string): Promise<{ records: LegacyRecord[]; exceptions: ExceptionRow[] }> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && f.toUpperCase().includes("MATRICULAS"));
  if (files.length === 0) throw new Error(`no MATRICULAS *.xlsx files found in ${dir}`);

  const records: LegacyRecord[] = [];
  const exceptions: ExceptionRow[] = [];

  for (const file of files) {
    const sheets = await readWorkbook(path.join(dir, file));
    for (const sheet of sheets) {
      const info = classifySheet(sheet.sheet);
      sheet.rows.forEach((row, index) => {
        const rowIndex = index + 2; // +1 header, +1 to be 1-based like a spreadsheet row
        const parsed = parseRow(row);
        if (!parsed.ok) {
          exceptions.push({ file, sheet: sheet.sheet, rowIndex, reason: parsed.reason, raw: JSON.stringify(row) });
          return;
        }
        const assembled = assemble(file, sheet.sheet, rowIndex, parsed.row, info);
        if (!assembled.ok) {
          exceptions.push({ file, sheet: sheet.sheet, rowIndex, reason: assembled.reason, raw: JSON.stringify(row) });
          return;
        }
        records.push(assembled.record);
      });
    }
  }

  // "Copia de X" / "buscar X" sheets are working copies of another sheet in
  // the same file (verified: 1-15 rows of drift per pair, not identical) —
  // the same (student, operation) pair showing up twice is that duplication,
  // not two real payments, so keep only the first occurrence.
  const seen = new Set<string>();
  const deduped: LegacyRecord[] = [];
  let dropped = 0;
  for (const record of records) {
    const key = record.operationNumber
      ? `${record.nationalId}|${record.operationNumber}`
      : `${record.sourceFile}|${record.sourceSheet}|${record.sourceRowIndex}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  if (dropped > 0) console.log(`Deduplicated ${dropped} rows (working-copy sheets repeating the same student+operation).`);

  return { records: deduped, exceptions };
}

function printSummary(records: LegacyRecord[], exceptions: ExceptionRow[]) {
  const byStatus = new Map<string, number>();
  const byCourse = new Map<string, number>();
  let totalCents = 0;
  for (const r of records) {
    byStatus.set(r.paymentStatus, (byStatus.get(r.paymentStatus) ?? 0) + 1);
    byCourse.set(r.courseName, (byCourse.get(r.courseName) ?? 0) + 1);
    if (r.paymentStatus === "approved") totalCents += r.amountCents;
  }
  console.log(`\n=== Legacy import summary ===`);
  console.log(`Parsed OK: ${records.length}  Exceptions: ${exceptions.length}`);
  console.log(`By payment status:`, Object.fromEntries(byStatus));
  console.log(`By course:`, Object.fromEntries(byCourse));
  console.log(`Total approved amount: S/${(totalCents / 100).toFixed(2)}`);
  console.log(`Distinct class groups: ${new Set(records.map(classGroupKey)).size}`);
}

async function writeReports(records: LegacyRecord[], exceptions: ExceptionRow[], outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "legacy-import-exceptions.csv"), toCsv(exceptions));
  fs.writeFileSync(
    path.join(outDir, "legacy-import-receipts.csv"),
    toCsv(
      records.map((r) => ({
        idempotencyKey: idempotencyKeyFor(r),
        nationalIdType: r.nationalIdType,
        nationalId: r.nationalId,
        fullName: `${r.firstName} ${r.lastName}`,
        course: r.courseName,
        modality: r.modality,
        moduleNumber: r.moduleNumber,
        amountSoles: (r.amountCents / 100).toFixed(2),
        paymentMethod: r.paymentMethod,
        operationNumber: r.operationNumber,
        paymentStatus: r.paymentStatus,
        channel: r.channel,
        bankAccount: r.bankAccount,
        receiptLinks: r.receiptLinks.join(" | "),
        sourceFile: r.sourceFile,
        sourceSheet: r.sourceSheet,
        sourceRowIndex: r.sourceRowIndex,
      })),
    ),
  );
  console.log(`\nReports written to ${outDir}:`);
  console.log(`  legacy-import-exceptions.csv (${exceptions.length} rows)`);
  console.log(`  legacy-import-receipts.csv (${records.length} rows, audit trail incl. original Drive links)`);
}

async function commitRecords(app: AppContainer, records: LegacyRecord[]) {
  const db = app.db;
  console.log(`\nEnsuring catalog (courses/plans/prices/class groups)...`);
  const { classGroupIdByKey, planIdByKey } = await ensureCatalog(db, records);

  let inserted = 0;
  let skippedExisting = 0;

  for (const record of records) {
    const idempotencyKey = idempotencyKeyFor(record);
    const [existingPayment] = await db.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
    if (existingPayment) {
      skippedExisting++;
      continue;
    }

    const studentId = await upsertStudent(db, record);
    const classGroupId = classGroupIdByKey.get(classGroupKey(record));
    if (!classGroupId) throw new Error(`no class group resolved for ${classGroupKey(record)}`);
    const planId = planIdByKey.get(`${record.courseKey}|${record.modality}`);
    if (!planId) throw new Error(`no plan resolved for ${record.courseKey}|${record.modality}`);
    const planPriceId = await resolvePlanPriceId(db, planId, record.amountCents);

    await db.transaction(async (tx) => {
      const [enrollment] = await tx
        .insert(enrollments)
        .values({
          studentId,
          classGroupId,
          planPriceId,
          seatStatus: SEAT_STATUS_BY_PAYMENT_STATUS[record.paymentStatus],
          origin: "whatsapp",
        })
        .returning();

      await tx.insert(payments).values({
        enrollmentId: enrollment!.id,
        idempotencyKey,
        status: record.paymentStatus,
        method: record.paymentMethod,
        methodDetail: record.methodDetail,
        amountCents: record.amountCents,
        operationNumber: record.operationNumber,
        // The spreadsheet already settled every row it imports except the
        // "under review" ones (payments_decided_at_check). It records no
        // decision date or reviewer, so the import date stands in and nobody
        // is named.
        decidedAt: record.paymentStatus === "under_review" ? null : new Date(),
      });
    });
    inserted++;
  }

  console.log(`\nInserted ${inserted} new enrollment+payment pairs. Skipped ${skippedExisting} already imported (idempotent re-run).`);
}

export async function run(app: AppContainer | null, options: RunOptions) {
  const { records, exceptions } = await collectRecords(options.dir);
  printSummary(records, exceptions);
  await writeReports(records, exceptions, options.outDir);

  if (!options.commit) {
    console.log(`\nDry run only — no database writes. Pass --commit to write.`);
    return;
  }
  if (!app) throw new Error("commit requested but no container was provided");
  await commitRecords(app, records);
}
