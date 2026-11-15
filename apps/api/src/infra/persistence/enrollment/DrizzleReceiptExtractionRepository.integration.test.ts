import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  paymentReceipts,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { RECEIPT_EXTRACTION_TIER_PRIMARY, type ReceiptExtraction } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleReceiptExtractionRepository } from "./DrizzleReceiptExtractionRepository.js";
import { DrizzleReceiptUploadRepository } from "./DrizzleReceiptUploadRepository.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";

/**
 * The OCR level 1 SQL (OOC-20): which receipts the relay offers, the
 * once-per-(receipt, tier) write, and that two receipts reading the same
 * operation number no longer collide (the unique index dropped in 0019).
 *
 * Same harness as DrizzleReceiptScreeningRepository.integration.test.ts:
 * `payments` and `payment_receipts` are under the delete lock of migration
 * 0011, so every test runs inside a transaction that is always rolled back.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the receipt extraction SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-6100-7000-8000-000000000001";
const COURSE = "018f2b5c-6100-7000-8000-000000000002";
const PLAN = "018f2b5c-6100-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-6100-7000-8000-000000000004";
const GROUP = "018f2b5c-6100-7000-8000-000000000005";

const TIER = RECEIPT_EXTRACTION_TIER_PRIMARY;

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class RolledBack extends Error {}

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await seedCatalog(tx);
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) {
      throw error;
    }
  }
}

async function seedCatalog(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (receipt extraction integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (extraction integration)", language: "Prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 15000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 50,
  });
  await seedModuleRuns(tx);
}

let sequence = 0;

async function payment(tx: Tx): Promise<string> {
  const n = ++sequence;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: `Alumno${n}`,
      lastName: "Extraccion",
      nationalIdType: "DNI",
      nationalId: `EXTRACT${n}`,
      email: `extract.${n}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, origin: "web" })
    .returning({ id: enrollments.id });
  const [row] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: `extract-integration-${n}`,
      method: "yape",
      amountCents: 15000,
    })
    .returning({ id: payments.id });
  return row!.id;
}

async function receipt(
  tx: Tx,
  params: { paymentId: string | null; status?: "uploaded" | "processed" },
): Promise<string> {
  const n = ++sequence;
  const status = params.status ?? "processed";
  const [hold] = await tx
    .insert(seatHolds)
    .values({ classGroupId: GROUP, origin: "web", status: "released", expiresAt: new Date(), settledAt: new Date() })
    .returning({ id: seatHolds.id });
  const [row] = await tx
    .insert(receiptUploads)
    .values({
      seatHoldId: hold!.id,
      paymentId: params.paymentId,
      objectKey: `receipts/raw/extract-integration/${n}`,
      status,
      processedObjectKey: status === "processed" ? `receipts/processed/extract-integration/${n}.jpg` : null,
    })
    .returning({ id: receiptUploads.id });
  return row!.id;
}

function extraction(operationNumber: string): ReceiptExtraction {
  return {
    modelName: "gemini-3.1-flash-lite",
    modelVersion: "gemini-3.1-flash-lite-001",
    fields: [
      { field: "amount_cents", value: 15000, confidence: 0.97 },
      { field: "operation_number", value: operationNumber, confidence: 0.92 },
      { field: "payment_method", value: "yape", detail: null, confidence: 0.99 },
      { field: "payer_name", value: null, confidence: 0 },
      { field: "paid_at", value: "2026-10-02T14:30:00.000Z", confidence: 0.9 },
    ],
  };
}

describe("listExtractableIds + findSubject", () => {
  it("offers only processed receipts attached to a payment and not yet read at the tier", async () => {
    await rolledBack(async (tx) => {
      const uploads = new DrizzleReceiptUploadRepository(tx as unknown as Db);
      const repository = new DrizzleReceiptExtractionRepository(tx as unknown as Db);

      const ready = await receipt(tx, { paymentId: await payment(tx) });
      const orphan = await receipt(tx, { paymentId: null });
      const notProcessed = await receipt(tx, { paymentId: await payment(tx), status: "uploaded" });
      const alreadyRead = await receipt(tx, { paymentId: await payment(tx) });
      const alreadyReadSubject = await repository.findSubject(alreadyRead, TIER);
      await repository.recordExtraction({ subject: alreadyReadSubject!, tier: TIER, extraction: extraction("111") });

      const offered = await uploads.listExtractableIds(1000, TIER);
      expect(offered).toContain(ready);
      expect(offered).not.toContain(orphan);
      expect(offered).not.toContain(notProcessed);
      expect(offered).not.toContain(alreadyRead);

      expect(await repository.findSubject(ready, TIER)).not.toBeNull();
      expect(await repository.findSubject(orphan, TIER)).toBeNull();
      expect(await repository.findSubject(notProcessed, TIER)).toBeNull();
      expect(await repository.findSubject(alreadyRead, TIER)).toBeNull();
      // Another tier still has its own reading to do (level 2, Sessão 29).
      expect(await repository.findSubject(alreadyRead, TIER + 1)).not.toBeNull();
    });
  });
});

describe("recordExtraction", () => {
  it("writes the reading with model, version, per-field confidence and the copied columns", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptExtractionRepository(tx as unknown as Db);
      const paymentId = await payment(tx);
      const receiptUploadId = await receipt(tx, { paymentId });
      const subject = await repository.findSubject(receiptUploadId, TIER);

      await repository.recordExtraction({ subject: subject!, tier: TIER, extraction: extraction("08312457") });

      const rows = await tx.select().from(paymentReceipts).where(eq(paymentReceipts.receiptUploadId, receiptUploadId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        paymentId,
        tier: TIER,
        modelName: "gemini-3.1-flash-lite",
        modelVersion: "gemini-3.1-flash-lite-001",
        amountCents: 15000,
        operationNumber: "08312457",
        failureReason: null,
        extractedFields: extraction("08312457").fields,
      });
    });
  });

  it("is a no-op the second time for the same receipt and tier", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptExtractionRepository(tx as unknown as Db);
      const receiptUploadId = await receipt(tx, { paymentId: await payment(tx) });
      const subject = await repository.findSubject(receiptUploadId, TIER);

      await repository.recordExtraction({ subject: subject!, tier: TIER, extraction: extraction("1") });
      await repository.recordExtraction({ subject: subject!, tier: TIER, extraction: extraction("2") });
      await repository.recordFailure({ subject: subject!, tier: TIER, modelName: "x", reason: "invalid_response" });

      const rows = await tx.select().from(paymentReceipts).where(eq(paymentReceipts.receiptUploadId, receiptUploadId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.operationNumber).toBe("1");
    });
  });

  it("lets two receipts read the same operation number — the guard is per method, on payments", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptExtractionRepository(tx as unknown as Db);
      for (let i = 0; i < 2; i++) {
        const receiptUploadId = await receipt(tx, { paymentId: await payment(tx) });
        const subject = await repository.findSubject(receiptUploadId, TIER);
        await repository.recordExtraction({ subject: subject!, tier: TIER, extraction: extraction("123456") });
      }

      const rows = await tx.select().from(paymentReceipts).where(eq(paymentReceipts.operationNumber, "123456"));
      expect(rows).toHaveLength(2);
    });
  });
});

describe("recordFailure", () => {
  it("writes a row with no fields and the reason, which stops the offer", async () => {
    await rolledBack(async (tx) => {
      const uploads = new DrizzleReceiptUploadRepository(tx as unknown as Db);
      const repository = new DrizzleReceiptExtractionRepository(tx as unknown as Db);
      const receiptUploadId = await receipt(tx, { paymentId: await payment(tx) });
      const subject = await repository.findSubject(receiptUploadId, TIER);

      await repository.recordFailure({
        subject: subject!,
        tier: TIER,
        modelName: "gemini-3.1-flash-lite",
        reason: "provider_unavailable",
      });

      const [row] = await tx.select().from(paymentReceipts).where(eq(paymentReceipts.receiptUploadId, receiptUploadId));
      expect(row).toMatchObject({
        tier: TIER,
        modelName: "gemini-3.1-flash-lite",
        modelVersion: null,
        extractedFields: null,
        amountCents: null,
        failureReason: "provider_unavailable",
      });
      expect(await uploads.listExtractableIds(1000, TIER)).not.toContain(receiptUploadId);
    });
  });
});
