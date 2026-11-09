import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, payments, planPrices, plans, receiptUploads, students } from "@ooc/db";
import { Enrollment, Payment, ReceiptNotReadyError } from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { seedManualReceipt } from "@/tests/fixtures/manualReceipt.js";
import { DrizzleEnrollmentRepository } from "./DrizzleEnrollmentRepository.js";

/**
 * The manual enrollment's receipt is mandatory (OOC-146): the payment is born
 * with an upload this same staff account started and confirmed, attached in
 * the same transaction that takes the seat — so the OCR ladder picks it up
 * like a checkout receipt. Someone else's upload, one not confirmed yet, or
 * one already paying for another enrollment is refused before the seat moves.
 *
 * Every test runs inside a transaction that never commits (students, payments
 * and plan_prices rows cannot be deleted afterwards — migrations 0011, 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the manual enrollment against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-5e00-7000-8000-000000000001";
const COURSE = "018f2b5c-5e00-7000-8000-000000000002";
const PLAN = "018f2b5c-5e00-7000-8000-000000000003";
const PRICE = "018f2b5c-5e00-7000-8000-000000000004";
const GROUP = "018f2b5c-5e00-7000-8000-000000000011";
const ROSA = "018f2b5c-5e00-7000-8000-000000000021";
const JUAN = "018f2b5c-5e00-7000-8000-000000000022";

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});
afterAll(async () => {
  await pool.end();
});

class RollBack extends Error {}

async function inRolledBackTransaction(fn: (tx: Db) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}

function studentRow(id: string, nationalId: string) {
  return {
    id,
    firstName: "Alumna",
    lastName: "Manual",
    nationalIdType: "DNI",
    nationalId,
    email: `${nationalId.toLowerCase()}@gmail.com`,
    phone: "+51900000000",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  };
}

async function seed(tx: Db): Promise<void> {
  const now = Date.now();
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (manual receipt integration)",
    startsOn: new Date(now - 30 * DAY),
    endsOn: new Date(now + 60 * DAY),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (manual receipt)", language: "Lengua de prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete (manual receipt)" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    slots: [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }],
    code: "MANUAL-RECEIPT-01",
    startsOn: new Date(now + 7 * DAY),
    endsOn: new Date(now + 50 * DAY),
    capacity: 10,
    seatsTaken: 0,
    status: "enrolling",
  });
  await tx.insert(students).values([studentRow(ROSA, "MANUAL-RECEIPT-1"), studentRow(JUAN, "MANUAL-RECEIPT-2")]);
}

function enrollmentFor(studentId: string, operationNumber: string) {
  const enrollment = Enrollment.createManual({ studentId, classGroupId: GROUP, planPriceId: PRICE });
  const payment = Payment.createManual({
    enrollmentId: enrollment.id,
    method: "yape",
    methodDetail: null,
    amountCents: 9900,
    operationNumber,
  });
  return { enrollment, payment };
}

async function seatsTaken(tx: Db): Promise<number | undefined> {
  const [row] = await tx.select({ seatsTaken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, GROUP));
  return row?.seatsTaken;
}

describe("manual enrollment receipt", { timeout: 30_000 }, () => {
  it("attaches the staff account's confirmed upload to the payment, which is born under review", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { receipt } = await seedManualReceipt(tx, "usr_manual_receipt_a");

      const { payment } = await new DrizzleEnrollmentRepository(tx).createWithPayment({
        ...enrollmentFor(ROSA, "MANUALRCPT0001"),
        notifications: [],
        receipt,
      });

      const [upload] = await tx.select().from(receiptUploads).where(eq(receiptUploads.id, receipt.receiptUploadId));
      expect(upload?.paymentId).toBe(payment.id);
      const [row] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, payment.id));
      expect(row?.status).toBe("under_review");
      expect(await seatsTaken(tx)).toBe(1);
    });
  });

  it("refuses an upload another staff account started, before the seat moves", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { receiptUploadId } = await seedManualReceipt(tx, "usr_manual_receipt_a");
      await seedManualReceipt(tx, "usr_manual_receipt_b");

      await expect(
        new DrizzleEnrollmentRepository(tx).createWithPayment({
          ...enrollmentFor(ROSA, "MANUALRCPT0002"),
          notifications: [],
          receipt: { receiptUploadId, uploadedBy: "usr_manual_receipt_b" },
        }),
      ).rejects.toBeInstanceOf(ReceiptNotReadyError);
      expect(await seatsTaken(tx)).toBe(0);
    });
  });

  it("refuses an upload that was never confirmed", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { receipt } = await seedManualReceipt(tx, "usr_manual_receipt_a");
      await tx.update(receiptUploads).set({ status: "pending" }).where(eq(receiptUploads.id, receipt.receiptUploadId));

      await expect(
        new DrizzleEnrollmentRepository(tx).createWithPayment({
          ...enrollmentFor(ROSA, "MANUALRCPT0003"),
          notifications: [],
          receipt,
        }),
      ).rejects.toBeInstanceOf(ReceiptNotReadyError);
    });
  });

  it("refuses one file paying for a second enrollment", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { receipt } = await seedManualReceipt(tx, "usr_manual_receipt_a");
      const repository = new DrizzleEnrollmentRepository(tx);
      await repository.createWithPayment({ ...enrollmentFor(ROSA, "MANUALRCPT0004"), notifications: [], receipt });

      await expect(
        repository.createWithPayment({ ...enrollmentFor(JUAN, "MANUALRCPT0005"), notifications: [], receipt }),
      ).rejects.toBeInstanceOf(ReceiptNotReadyError);
      expect(await seatsTaken(tx)).toBe(1);
    });
  });

  it("still refuses a receipt upload with no owner", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await seedManualReceipt(tx, "usr_manual_receipt_a");

      await expect(
        tx.execute(sql`insert into receipt_uploads (object_key) values ('receipts/raw/manual/no-owner')`),
      ).rejects.toThrow();
    });
  });
});
