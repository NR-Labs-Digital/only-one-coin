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
  paymentReceipts,
  platformSettings,
  receiptRereads,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzlePlatformSettingsRepository } from "@/infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { ListPaymentReviewQueueQuery } from "./ListPaymentReviewQueueQuery.js";
import { ListPaymentsQuery } from "./ListPaymentsQuery.js";

/**
 * The two reads behind the Payments screens (OOC-55): the ledger of every
 * payment and the queue of the ones still open. What has to hold is the SQL
 * the type checker cannot see — which upload speaks for a payment, which
 * audit entry names the decision, and that every filter runs in Postgres.
 *
 * `payments`, `students` and `audit_log` are under the delete lock (0011):
 * every test runs in a transaction that is always rolled back, and every
 * assertion is narrowed to this suite's own academic period so rows already
 * in the database never leak in.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the payment read SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-9000-7000-8000-000000000001";
const COURSE = "018f2b5c-9000-7000-8000-000000000002";
const PLAN = "018f2b5c-9000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-9000-7000-8000-000000000004";
const GROUP = "018f2b5c-9000-7000-8000-000000000005";
const PERIOD_NAME = "Ciclo de prueba (payment queries integration)";

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
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: PERIOD_NAME,
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (payment queries integration)", language: "Prueba", minAge: 12 });
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
    seatsTaken: 4,
  });
}

interface SeededPayments {
  pending: string;
  underReview: string;
  approved: string;
  rejected: string;
  operationOf: { pending: string; underReview: string; approved: string; rejected: string };
}

type SeedKey = keyof SeededPayments["operationOf"];

/**
 * Four payments in the suite's period, a minute apart, oldest first: one
 * nobody has sent a receipt for, one whose receipt was screened and flagged,
 * one approved and one rejected. The approval also has an audit entry by
 * someone else, which the ledger must not read.
 */
/** Thirty seconds after the payment came in. */
function decidedAtOf(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 30_000);
}

/** What OCR level 1 left on the under-review payment's receipt. */
type SeedReading = "read" | "failed" | "none";

async function seedPayments(tx: Tx, reading: SeedReading = "read"): Promise<SeededPayments> {
  const stamp = Date.now();
  const base = stamp - 10 * 60_000;
  const plan: { key: SeedKey; status: string; seatStatus: "reserved" | "confirmed" | "released" }[] = [
    { key: "pending", status: "pending", seatStatus: "reserved" },
    { key: "underReview", status: "under_review", seatStatus: "reserved" },
    { key: "approved", status: "approved", seatStatus: "confirmed" },
    { key: "rejected", status: "rejected", seatStatus: "released" },
  ];

  const ids = {} as Record<SeedKey, string>;
  const enrollmentOf = {} as Record<SeedKey, string>;
  const operationOf = {} as Record<SeedKey, string>;

  for (const [index, entry] of plan.entries()) {
    const [student] = await tx
      .insert(students)
      .values({
        firstName: "Pago",
        lastName: `Consulta${index}`,
        nationalIdType: "DNI",
        nationalId: `PAYQ${stamp}${index}`,
        email: `payq.${stamp}.${index}@gmail.com`,
        phone: "+51900000000",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        country: "PE",
        city: "Lima",
      })
      .returning({ id: students.id });
    const [enrollment] = await tx
      .insert(enrollments)
      .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, seatStatus: entry.seatStatus })
      .returning({ id: enrollments.id });
    const createdAt = new Date(base + index * 60_000);
    operationOf[entry.key] = `OPPAYQ${stamp}${index}`;
    const [payment] = await tx
      .insert(payments)
      .values({
        enrollmentId: enrollment!.id,
        idempotencyKey: `payment-queries-integration-${stamp}-${index}`,
        status: entry.status,
        method: "yape",
        amountCents: 15000,
        operationNumber: operationOf[entry.key],
        createdAt,
        updatedAt: createdAt,
        // A decided payment always says when (payments_decided_at_check);
        // nobody is named, as on a row decided outside the panel.
        decidedAt: entry.status === "approved" || entry.status === "rejected" ? decidedAtOf(createdAt) : null,
      })
      .returning({ id: payments.id });
    ids[entry.key] = payment!.id;
    enrollmentOf[entry.key] = enrollment!.id;
  }

  const [hold] = await tx
    .insert(seatHolds)
    .values({
      classGroupId: GROUP,
      origin: "web",
      status: "consumed",
      enrollmentId: enrollmentOf.underReview,
      settledAt: new Date(),
      expiresAt: new Date(),
    })
    .returning({ id: seatHolds.id });
  const [upload] = await tx.insert(receiptUploads).values({
    seatHoldId: hold!.id,
    paymentId: ids.underReview,
    objectKey: `receipts/payment-queries-integration/${stamp}/raw.jpg`,
    processedObjectKey: `receipts/payment-queries-integration/${stamp}/processed.jpg`,
    status: "processed",
    fraudSignals: [
      { kind: "identical_file", receiptUploadId: "018f2b5c-9000-7000-8000-0000000000aa", paymentId: "018f2b5c-9000-7000-8000-0000000000bb" },
      // A kind this version does not know (a later screening, a hand edit):
      // dropped on the way out, never passed to the route's closed enum.
      { kind: "kind_from_a_later_version" },
    ],
    screenedAt: new Date(),
  }).returning({ id: receiptUploads.id });

  if (reading === "read") {
    await tx.insert(paymentReceipts).values({
      paymentId: ids.underReview,
      receiptUploadId: upload!.id,
      tier: 1,
      modelName: "google/gemini-3.1-flash-lite",
      modelVersion: "google/gemini-3.1-flash-lite via Google",
      amountCents: 14990,
      operationNumber: "08312457",
      extractedFields: [
        { field: "amount_cents", value: 14990, confidence: 0.97 },
        { field: "operation_number", value: "08312457", confidence: 0.92 },
        { field: "payment_method", value: "other", detail: "BBVA", confidence: 0.8 },
        // A malformed value (a hand edit, an older writer): read as not read,
        // never passed to the route's schema.
        { field: "payer_name", value: 42, confidence: 0.9 },
        { field: "paid_at", value: "2026-10-02T14:30:00.000Z", confidence: 7 },
      ],
    });
  } else if (reading === "failed") {
    await tx.insert(paymentReceipts).values({
      paymentId: ids.underReview,
      receiptUploadId: upload!.id,
      tier: 1,
      modelName: "google/gemini-3.1-flash-lite",
      failureReason: "provider_unavailable",
    });
  }

  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role") values ('usr_payment_queries_trail', 'Solo en la trilla', 'usr_payment_queries_trail@example.com', true, 'billing')`,
  );
  await tx.insert(auditLog).values({
    actorId: "usr_payment_queries_trail",
    action: "payment.approved",
    targetId: ids.approved,
    metadata: { test: true },
  });

  return { ...ids, operationOf };
}

const READER = "usr_payment_queries_reader";

/** The queue reads its review window from platform_settings (OOC-41). */
function reviewQueue(tx: Tx): ListPaymentReviewQueueQuery {
  return new ListPaymentReviewQueueQuery(tx as unknown as Db, new DrizzlePlatformSettingsRepository(tx as unknown as Db));
}

/**
 * One more open payment with a processed, read and judged receipt, for the
 * priority order (Sessão 32). `confidence` goes on the three fields the
 * order looks at; `minutesAgo` sets its arrival.
 */
async function seedJudgedPayment(
  tx: Tx,
  params: { tag: string; minutesAgo: number; verdict: "approve" | "review" | "reject_suggested"; confidence: number },
): Promise<{ paymentId: string; uploadId: string }> {
  const stamp = `${Date.now()}${params.tag}`;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Prioridad",
      lastName: params.tag,
      nationalIdType: "DNI",
      nationalId: `PRIO${stamp}`,
      email: `prio.${stamp}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, seatStatus: "reserved" })
    .returning({ id: enrollments.id });
  const createdAt = new Date(Date.now() - params.minutesAgo * 60_000);
  const [payment] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: `payment-queries-priority-${stamp}`,
      status: params.verdict === "approve" ? "pending" : "under_review",
      method: "yape",
      amountCents: 15000,
      operationNumber: `OPPRIO${stamp}`,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: payments.id });
  const [hold] = await tx
    .insert(seatHolds)
    .values({ classGroupId: GROUP, origin: "web", status: "consumed", enrollmentId: enrollment!.id, settledAt: new Date(), expiresAt: new Date() })
    .returning({ id: seatHolds.id });
  const [upload] = await tx
    .insert(receiptUploads)
    .values({
      seatHoldId: hold!.id,
      paymentId: payment!.id,
      objectKey: `receipts/payment-queries-priority/${stamp}/raw.jpg`,
      processedObjectKey: `receipts/payment-queries-priority/${stamp}/processed.jpg`,
      status: "processed",
      fraudSignals: [],
      screenedAt: new Date(),
      validationVerdict: params.verdict,
      validationDetail: { reason: params.verdict === "approve" ? "exact" : params.verdict === "review" ? "underpaid" : "far_below" },
      validatedAt: new Date(),
    })
    .returning({ id: receiptUploads.id });
  await tx.insert(paymentReceipts).values({
    paymentId: payment!.id,
    receiptUploadId: upload!.id,
    tier: 1,
    modelName: "google/gemini-3.1-flash-lite",
    amountCents: 15000,
    operationNumber: `OPPRIO${stamp}`,
    extractedFields: [
      { field: "amount_cents", value: 15000, confidence: params.confidence },
      { field: "operation_number", value: `OPPRIO${stamp}`, confidence: 0.99 },
      { field: "payment_method", value: "yape", detail: null, confidence: 0.99 },
    ],
  });
  return { paymentId: payment!.id, uploadId: upload!.id };
}

async function seedReader(tx: Tx): Promise<void> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role") values (${READER}, 'Revisora', ${`${READER}@example.com`}, true, 'billing')`,
  );
}

describe("ListPaymentReviewQueueQuery", () => {
  it("lists only open payments, oldest first, with receipt state, signals and deadline", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD, sort: "oldest" });

      expect(queue.total).toBe(2);
      expect(queue.items.map((item) => item.id)).toEqual([seeded.pending, seeded.underReview]);
      expect(queue.items[0]!.receipt).toBe("missing");
      expect(queue.items[1]!.receipt).toBe("ready");
      expect(queue.items[0]!.fraudSignals).toEqual([]);
      expect(queue.items[1]!.fraudSignals).toEqual(["identical_file"]);
      const item = queue.items[0]!;
      const { reviewWindowDays } = await new DrizzlePlatformSettingsRepository(tx as unknown as Db).get();
      expect(item.reviewDeadline.getTime() - item.submittedAt.getTime()).toBe(reviewWindowDays * 24 * 60 * 60 * 1000);
      expect(item.expectedAmountCents).toBe(15000);
      expect(item).toMatchObject({ classGroupName: "Lun/Mié 19:00", planName: "Paquete completo", status: "pending", currency: "PEN" });
    });
  });

  it("carries the OCR reading of the latest receipt, field by field (OOC-20)", async () => {
    await rolledBack(async (tx) => {
      await seedPayments(tx, "read");
      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      // No receipt, nothing to read.
      expect(queue.items[0]!.reading).toBeNull();
      expect(queue.items[1]!.reading).toMatchObject({
        state: "read",
        modelName: "google/gemini-3.1-flash-lite",
        modelVersion: "google/gemini-3.1-flash-lite via Google",
        amountCents: { value: 14990, confidence: 0.97 },
        operationNumber: { value: "08312457", confidence: 0.92 },
        paymentMethod: { value: "other", detail: "BBVA", confidence: 0.8 },
        payerName: { value: null, confidence: 0 },
        // A confidence outside 0–1 is not trusted either.
        paidAt: { value: "2026-10-02T14:30:00.000Z", confidence: 0 },
      });
    });
  });

  it("says when the OCR failed, and when it has not read the receipt yet", async () => {
    await rolledBack(async (tx) => {
      await seedPayments(tx, "failed");
      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });
      expect(queue.items[1]!.reading).toMatchObject({ state: "failed", reason: "provider_unavailable" });
    });
    await rolledBack(async (tx) => {
      await seedPayments(tx, "none");
      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });
      expect(queue.items[1]!.reading).toEqual({ state: "not_read" });
    });
  });

  it("carries the traffic light's verdict of the latest receipt (OOC-21)", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx, "read");
      await tx
        .update(receiptUploads)
        .set({
          validationVerdict: "reject_suggested",
          validationDetail: { reason: "far_below", expectedCents: 15000, readCents: 4000, toleranceCents: 0, rejectBelowPercent: 50 },
          validatedAt: new Date(),
        })
        .where(eq(receiptUploads.paymentId, seeded.underReview));

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD, sort: "oldest" });

      expect(queue.items[0]!.verdict).toBeNull();
      expect(queue.items[1]!.verdict).toEqual({ verdict: "reject_suggested", reason: "far_below" });
    });
  });

  it("reads an odd stored verdict as no verdict, never a 500", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx, "read");
      await tx
        .update(receiptUploads)
        .set({ validationVerdict: "review", validationDetail: { reason: "reason_from_a_later_version" }, validatedAt: new Date() })
        .where(eq(receiptUploads.paymentId, seeded.underReview));

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      expect(queue.items[1]!.verdict).toBeNull();
    });
  });

  it("finds an open payment by its operation number", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const queue = await reviewQueue(tx).run({
        academicPeriodId: PERIOD,
        q: seeded.operationOf.underReview,
      });

      expect(queue.items.map((item) => item.id)).toEqual([seeded.underReview]);
    });
  });

  it("measures the deadline with the review window set in the backoffice (OOC-41)", async () => {
    await rolledBack(async (tx) => {
      await seedPayments(tx);
      await tx.update(platformSettings).set({ reviewWindowDays: 9 });

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      const item = queue.items[0]!;
      expect(item.reviewDeadline.getTime() - item.submittedAt.getTime()).toBe(9 * 24 * 60 * 60 * 1000);
    });
  });

  it("orders by priority by default: red, yellow, green, least confident first (Sessão 32)", async () => {
    await rolledBack(async (tx) => {
      const greenSure = await seedJudgedPayment(tx, { tag: "a", minutesAgo: 50, verdict: "approve", confidence: 0.99 });
      const greenShaky = await seedJudgedPayment(tx, { tag: "b", minutesAgo: 40, verdict: "approve", confidence: 0.4 });
      const yellowSure = await seedJudgedPayment(tx, { tag: "c", minutesAgo: 30, verdict: "review", confidence: 0.95 });
      const yellowShaky = await seedJudgedPayment(tx, { tag: "d", minutesAgo: 20, verdict: "review", confidence: 0.3 });
      const red = await seedJudgedPayment(tx, { tag: "e", minutesAgo: 10, verdict: "reject_suggested", confidence: 0.9 });
      const query = reviewQueue(tx);

      const byPriority = await query.run({ academicPeriodId: PERIOD });
      expect(byPriority.items.map((item) => item.id)).toEqual([
        red.paymentId,
        yellowShaky.paymentId,
        yellowSure.paymentId,
        greenShaky.paymentId,
        greenSure.paymentId,
      ]);
      expect(byPriority.items[1]!.confidence).toBeCloseTo(0.3);

      const byArrival = await query.run({ academicPeriodId: PERIOD, sort: "oldest" });
      expect(byArrival.items.map((item) => item.id)).toEqual([
        greenSure.paymentId,
        greenShaky.paymentId,
        yellowSure.paymentId,
        yellowShaky.paymentId,
        red.paymentId,
      ]);
    });
  });

  it("puts a payment with no verdict among the yellows, as unread", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx, "none");
      const yellow = await seedJudgedPayment(tx, { tag: "f", minutesAgo: 1, verdict: "review", confidence: 0.5 });
      const green = await seedJudgedPayment(tx, { tag: "g", minutesAgo: 60, verdict: "approve", confidence: 0.2 });

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      // No verdict and no reading → confidence 0, ahead of the 0.5 yellow;
      // the green comes last however old and shaky it is.
      expect(queue.items.map((item) => item.id)).toEqual([seeded.pending, seeded.underReview, yellow.paymentId, green.paymentId]);
      expect(queue.items[0]!.confidence).toBeNull();
    });
  });

  it("an answered re-read replaces the first reading and its verdict, and moves the order", async () => {
    await rolledBack(async (tx) => {
      await seedReader(tx);
      const first = await seedJudgedPayment(tx, { tag: "h", minutesAgo: 20, verdict: "review", confidence: 0.9 });
      const reread = await seedJudgedPayment(tx, { tag: "i", minutesAgo: 10, verdict: "review", confidence: 0.2 });
      await tx.insert(receiptRereads).values({
        paymentId: reread.paymentId,
        receiptUploadId: reread.uploadId,
        requestedBy: READER,
        tier: 1,
        modelName: "google/gemini-3.1-flash-lite",
        amountCents: 15000,
        extractedFields: [
          { field: "amount_cents", value: 15000, confidence: 0.99 },
          { field: "operation_number", value: "READAGAIN", confidence: 0.98 },
          { field: "payment_method", value: "yape", detail: null, confidence: 0.97 },
        ],
        validationVerdict: "approve",
        validationDetail: { reason: "exact" },
        readAt: new Date(),
      });

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      // Green now: behind the yellow it used to be ahead of.
      expect(queue.items.map((item) => item.id)).toEqual([first.paymentId, reread.paymentId]);
      const item = queue.items[1]!;
      expect(item.readingSource).toBe("reread");
      expect(item.verdict).toEqual({ verdict: "approve", reason: "exact" });
      expect(item.reading).toMatchObject({ state: "read", operationNumber: { value: "READAGAIN", confidence: 0.98 } });
      expect(item.rereadRequestedAt).toBeNull();
      // The re-read never moved the payment.
      expect(item.status).toBe("under_review");
      expect(queue.items[0]!.readingSource).toBe("first");
    });
  });

  it("says when a re-read is still on its way, keeping the reading it has", async () => {
    await rolledBack(async (tx) => {
      await seedReader(tx);
      const judged = await seedJudgedPayment(tx, { tag: "j", minutesAgo: 5, verdict: "review", confidence: 0.6 });
      await tx.insert(receiptRereads).values({
        paymentId: judged.paymentId,
        receiptUploadId: judged.uploadId,
        requestedBy: READER,
        tier: 1,
      });

      const queue = await reviewQueue(tx).run({ academicPeriodId: PERIOD });

      expect(queue.items[0]!.rereadRequestedAt).toBeInstanceOf(Date);
      expect(queue.items[0]!.readingSource).toBe("first");
      expect(queue.items[0]!.verdict).toEqual({ verdict: "review", reason: "underpaid" });
    });
  });
});

describe("ListPaymentsQuery", () => {
  it("lists every payment of the period, newest first", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD });

      expect(ledger.total).toBe(4);
      expect(ledger.items.map((row) => row.id)).toEqual([seeded.rejected, seeded.approved, seeded.underReview, seeded.pending]);
    });
  });

  it("sorts oldest first when asked", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, sort: "oldest" });

      expect(ledger.items.map((row) => row.id)).toEqual([seeded.pending, seeded.underReview, seeded.approved, seeded.rejected]);
    });
  });

  it("filters by status in Postgres", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, status: "approved" });

      expect(ledger.total).toBe(1);
      expect(ledger.items.map((row) => row.id)).toEqual([seeded.approved]);
    });
  });

  it("reads when it was decided from the payment, never from the audit trail", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const [row] = await tx.select({ decidedAt: payments.decidedAt }).from(payments).where(eq(payments.id, seeded.approved));
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, status: "approved" });

      expect(ledger.items[0]!.id).toBe(seeded.approved);
      expect(ledger.items[0]!.decidedAt).toEqual(row!.decidedAt);
      // The trail names someone; the payment names nobody — the ledger
      // follows the payment.
      expect(ledger.items[0]!.decidedByName).toBeNull();
    });
  });

  it("an open payment has no decision", async () => {
    await rolledBack(async (tx) => {
      await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, status: "pending" });

      expect(ledger.items[0]).toMatchObject({ decidedAt: null, decidedByName: null });
    });
  });

  it("reads the decider's name from the Better Auth user table", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const userId = "usr_payment_queries_integration_billing";
      await tx.execute(
        sql`insert into "user" ("id", "name", "email", "emailVerified", "role") values (${userId}, 'Caja Prueba', ${`${userId}@example.com`}, true, 'billing')`,
      );
      await tx.update(payments).set({ decidedBy: userId }).where(eq(payments.id, seeded.rejected));

      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, status: "rejected" });

      expect(ledger.items.map((row) => row.id)).toEqual([seeded.rejected]);
      expect(ledger.items[0]!.decidedByName).toBe("Caja Prueba");
    });
  });

  it("finds a payment by its operation number", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, q: seeded.operationOf.approved });

      expect(ledger.items.map((row) => row.id)).toEqual([seeded.approved]);
    });
  });

  it("the open tab holds only what still needs a decision (OOC-114)", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD, state: "open" });

      expect(ledger.total).toBe(2);
      expect(ledger.items.map((row) => row.id)).toEqual([seeded.underReview, seeded.pending]);
      expect(ledger.counts).toEqual({ open: 2, closed: 2 });
    });
  });

  it("the closed tab is ordered by when it was decided, not when it came in", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      // The older payment was settled last.
      await tx
        .update(payments)
        .set({ decidedAt: sql`now() + interval '1 hour'` })
        .where(eq(payments.id, seeded.approved));

      const query = new ListPaymentsQuery(tx as unknown as Db);
      const newest = await query.run({ academicPeriodId: PERIOD, state: "closed" });
      const oldest = await query.run({ academicPeriodId: PERIOD, state: "closed", sort: "oldest" });

      expect(newest.total).toBe(2);
      expect(newest.items.map((row) => row.id)).toEqual([seeded.approved, seeded.rejected]);
      expect(oldest.items.map((row) => row.id)).toEqual([seeded.rejected, seeded.approved]);
    });
  });

  it("the fine status narrows inside the tab, and the counters ignore both", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const query = new ListPaymentsQuery(tx as unknown as Db);
      const within = await query.run({ academicPeriodId: PERIOD, state: "closed", status: "rejected" });
      const across = await query.run({ academicPeriodId: PERIOD, state: "open", status: "approved" });

      expect(within.items.map((row) => row.id)).toEqual([seeded.rejected]);
      expect(within.counts).toEqual({ open: 2, closed: 2 });
      expect(across.total).toBe(0);
    });
  });

  it("the counters follow the search", async () => {
    await rolledBack(async (tx) => {
      const seeded = await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({
        academicPeriodId: PERIOD,
        state: "open",
        q: seeded.operationOf.approved,
      });

      expect(ledger.total).toBe(0);
      expect(ledger.counts).toEqual({ open: 0, closed: 1 });
    });
  });

  it("the open tab counts what the review queue lists — the number on the menu badge", async () => {
    await rolledBack(async (tx) => {
      await seedPayments(tx);
      const ledger = await new ListPaymentsQuery(tx as unknown as Db).run({ state: "open" });
      const queue = await reviewQueue(tx).run({});

      expect(ledger.counts.open).toBe(queue.total);
      expect(ledger.total).toBe(queue.total);
    });
  });

  it("counts the header figures over the current period", async () => {
    await rolledBack(async (tx) => {
      // Make the suite's period the most recent one already started, so the
      // metrics read this period and nothing else in the database.
      await tx
        .update(academicPeriods)
        .set({ startsOn: sql`now() - interval '1 minute'`, endsOn: sql`now() + interval '30 days'` })
        .where(eq(academicPeriods.id, PERIOD));
      await seedPayments(tx);

      const { metrics } = await new ListPaymentsQuery(tx as unknown as Db).run({ academicPeriodId: PERIOD });

      expect(metrics).toEqual({
        periodName: PERIOD_NAME,
        inReview: 2,
        oldestOpenHours: 0,
        approved: 1,
        collectedCents: 15000,
        rejected: 1,
      });
    });
  });
});
