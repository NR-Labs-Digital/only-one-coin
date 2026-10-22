import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroups,
  courses,
  enrollments,
  payments,
  planPrices,
  plans,
  receiptRereads,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import {
  PaymentAlreadySettledError,
  PaymentNotFoundError,
  ReceiptNotRereadableError,
  ReceiptRereadInProgressError,
} from "@ooc/domain";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleReceiptRereadRepository } from "./DrizzleReceiptRereadRepository.js";

/**
 * The re-read's SQL (ROADMAP Sessão 32): the request and its audit entry in
 * one transaction, one pending request per receipt held by the partial
 * unique index, and an answer stamped once — none of it touching the
 * payment's status.
 *
 * `payments`, `students`, `audit_log` and `receipt_rereads` are under the
 * delete lock: every test runs in a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the receipt re-read SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-a000-7000-8000-000000000001";
const COURSE = "018f2b5c-a000-7000-8000-000000000002";
const PLAN = "018f2b5c-a000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-a000-7000-8000-000000000004";
const GROUP = "018f2b5c-a000-7000-8000-000000000005";
const REVIEWER = "usr_receipt_reread";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await seedCatalog(tx);
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function seedCatalog(tx: Tx): Promise<void> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${REVIEWER}, 'Caja', 'billing.reread@test.local', true, 'billing', now(), now())`,
  );
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (reread integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (reread integration)", language: "Prueba", minAge: 12 });
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
    seatsTaken: 1,
  });
}

/** An open payment, with a receipt in the given state (or none). */
async function seedPayment(
  tx: Tx,
  params: { status?: "pending" | "under_review" | "approved"; receipt?: "processed" | "uploaded" | "none" } = {},
): Promise<{ paymentId: string; uploadId: string | null }> {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const status = params.status ?? "under_review";
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Relectura",
      lastName: "Prueba",
      nationalIdType: "DNI",
      nationalId: `RRD${stamp}`,
      email: `rrd.${stamp}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, seatStatus: status === "approved" ? "confirmed" : "reserved" })
    .returning({ id: enrollments.id });
  const [payment] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: `reread-integration-${stamp}`,
      status,
      method: "yape",
      amountCents: 15000,
      operationNumber: `OPRRD${stamp}`,
      decidedAt: status === "approved" ? new Date() : null,
    })
    .returning({ id: payments.id });

  const receipt = params.receipt ?? "processed";
  if (receipt === "none") return { paymentId: payment!.id, uploadId: null };

  const [hold] = await tx
    .insert(seatHolds)
    .values({ classGroupId: GROUP, origin: "web", status: "consumed", enrollmentId: enrollment!.id, settledAt: new Date(), expiresAt: new Date() })
    .returning({ id: seatHolds.id });
  const [upload] = await tx
    .insert(receiptUploads)
    .values({
      seatHoldId: hold!.id,
      paymentId: payment!.id,
      objectKey: `receipts/reread-integration/${stamp}/raw.jpg`,
      processedObjectKey: receipt === "processed" ? `receipts/reread-integration/${stamp}/processed.jpg` : null,
      status: receipt,
    })
    .returning({ id: receiptUploads.id });
  return { paymentId: payment!.id, uploadId: upload!.id };
}

const TIER = 1;

describe("DrizzleReceiptRereadRepository.request", () => {
  it("records the request on the latest receipt and audits it in the same transaction", async () => {
    await rolledBack(async (tx) => {
      const { paymentId, uploadId } = await seedPayment(tx);
      const repository = new DrizzleReceiptRereadRepository(tx as unknown as Db);

      const result = await repository.request({ paymentId, actorId: REVIEWER, tier: TIER });

      expect(result.receiptUploadId).toBe(uploadId);
      const [row] = await tx.select().from(receiptRereads).where(eq(receiptRereads.id, result.rereadId));
      expect(row).toMatchObject({ paymentId, receiptUploadId: uploadId, requestedBy: REVIEWER, tier: TIER, readAt: null });
      const trail = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.targetId, paymentId), eq(auditLog.action, "payment.receipt_reread_requested")));
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({ actorId: REVIEWER, metadata: { receiptUploadId: uploadId, rereadId: result.rereadId } });
    });
  });

  it("refuses a second request while the first is still with the model", async () => {
    await rolledBack(async (tx) => {
      const { paymentId } = await seedPayment(tx);
      const repository = new DrizzleReceiptRereadRepository(tx as unknown as Db);
      await repository.request({ paymentId, actorId: REVIEWER, tier: TIER });

      await expect(repository.request({ paymentId, actorId: REVIEWER, tier: TIER })).rejects.toBeInstanceOf(
        ReceiptRereadInProgressError,
      );
    });
  });

  it("refuses a settled payment, an unknown one, and one without a processed receipt", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptRereadRepository(tx as unknown as Db);
      const settled = await seedPayment(tx, { status: "approved" });
      const noReceipt = await seedPayment(tx, { receipt: "none" });
      const stillUploading = await seedPayment(tx, { receipt: "uploaded" });

      await expect(repository.request({ paymentId: settled.paymentId, actorId: REVIEWER, tier: TIER })).rejects.toBeInstanceOf(
        PaymentAlreadySettledError,
      );
      await expect(
        repository.request({ paymentId: "018f2b5c-a000-7000-8000-0000000000ff", actorId: REVIEWER, tier: TIER }),
      ).rejects.toBeInstanceOf(PaymentNotFoundError);
      await expect(repository.request({ paymentId: noReceipt.paymentId, actorId: REVIEWER, tier: TIER })).rejects.toBeInstanceOf(
        ReceiptNotRereadableError,
      );
      await expect(
        repository.request({ paymentId: stillUploading.paymentId, actorId: REVIEWER, tier: TIER }),
      ).rejects.toBeInstanceOf(ReceiptNotRereadableError);
    });
  });
});

describe("DrizzleReceiptRereadRepository answer", () => {
  it("offers the pending request, stamps the answer once, and leaves the payment where it was", async () => {
    await rolledBack(async (tx) => {
      const { paymentId } = await seedPayment(tx, { status: "under_review" });
      const repository = new DrizzleReceiptRereadRepository(tx as unknown as Db);
      const { rereadId } = await repository.request({ paymentId, actorId: REVIEWER, tier: TIER });

      expect(await repository.listPendingIds(500)).toContain(rereadId);
      const subject = await repository.findPending(rereadId);
      expect(subject).toMatchObject({ rereadId, paymentId, expectedCents: 15000, declaredMethod: "yape" });

      const answer = {
        subject: subject!,
        result: {
          kind: "read" as const,
          extraction: {
            modelName: "google/gemini-3.1-flash-lite",
            modelVersion: "google/gemini-3.1-flash-lite via Google",
            fields: [
              { field: "amount_cents" as const, value: 15000, confidence: 0.99 },
              { field: "operation_number" as const, value: "123", confidence: 0.9 },
            ],
          },
        },
        outcome: { verdict: "approve" as const, reason: "exact" as const },
        detail: { reason: "exact" as const, expectedCents: 15000, readCents: 15000, toleranceCents: 0, rejectBelowPercent: 50 },
      };
      expect(await repository.record(answer)).toBe(true);
      // A redelivered job finds it answered.
      expect(await repository.record(answer)).toBe(false);
      expect(await repository.findPending(rereadId)).toBeNull();
      expect(await repository.listPendingIds(500)).not.toContain(rereadId);

      const [row] = await tx.select().from(receiptRereads).where(eq(receiptRereads.id, rereadId));
      expect(row).toMatchObject({ amountCents: 15000, operationNumber: "123", validationVerdict: "approve", failureReason: null });
      expect(row!.readAt).toBeInstanceOf(Date);

      const [payment] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
      expect(payment!.status).toBe("under_review");

      // Answered, the receipt may be read again.
      await expect(repository.request({ paymentId, actorId: REVIEWER, tier: TIER })).resolves.toBeDefined();
    });
  });

  it("records a failed reading with its reason", async () => {
    await rolledBack(async (tx) => {
      const { paymentId } = await seedPayment(tx);
      const repository = new DrizzleReceiptRereadRepository(tx as unknown as Db);
      const { rereadId } = await repository.request({ paymentId, actorId: REVIEWER, tier: TIER });
      const subject = await repository.findPending(rereadId);

      await repository.record({
        subject: subject!,
        result: { kind: "failed", modelName: "google/gemini-3.1-flash-lite", reason: "provider_unavailable" },
        outcome: { verdict: "review", reason: "amount_unread" },
        detail: { reason: "amount_unread", expectedCents: 15000, readCents: null, toleranceCents: 0, rejectBelowPercent: 50 },
      });

      const [row] = await tx.select().from(receiptRereads).where(eq(receiptRereads.id, rereadId));
      expect(row).toMatchObject({
        failureReason: "provider_unavailable",
        extractedFields: null,
        modelName: "google/gemini-3.1-flash-lite",
        validationVerdict: "review",
      });
    });
  });
});
