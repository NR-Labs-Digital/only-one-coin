import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroups,
  courses,
  enrollments,
  paymentReceipts,
  payments,
  planPrices,
  plans,
  procedurePrices,
  procedureRequests,
  receiptUploads,
  students,
} from "@ooc/db";
import {
  OperationNumberAlreadyUsedError,
  ProcedureNotPayableError,
  ReceiptNotReadyError,
  type AuditLogEntry,
} from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleReceiptScreeningRepository } from "@/infra/persistence/enrollment/DrizzleReceiptScreeningRepository.js";
import { DrizzleReceiptValidationRepository } from "@/infra/persistence/enrollment/DrizzleReceiptValidationRepository.js";
import { DrizzlePaymentSettlementRepository } from "@/infra/persistence/payment/DrizzlePaymentSettlementRepository.js";
import { ListPaymentReviewQueueQuery } from "@/infra/persistence/payment/ListPaymentReviewQueueQuery.js";
import { ListPaymentsQuery } from "@/infra/persistence/payment/ListPaymentsQuery.js";
import { DrizzlePlatformSettingsRepository } from "@/infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { DrizzleProcedureRepository } from "./DrizzleProcedureRepository.js";

/**
 * Paid procedures against the real SQL (OOC-83): the origin CHECK, the frozen
 * price, and above all that settling a procedure's money never moves the seat of
 * the enrollment it refers to. Every test runs in a transaction that is always
 * rolled back: `payments` and `students` are under the delete lock (0011).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the procedure payment SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-8300-7000-8000-000000000001";
const COURSE = "018f2b5c-8300-7000-8000-000000000002";
const PLAN = "018f2b5c-8300-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-8300-7000-8000-000000000004";
const GROUP = "018f2b5c-8300-7000-8000-000000000005";
const REVIEWER = "usr_procedure_billing";
const OWNER = "usr_procedure_student";
const STRANGER = "usr_procedure_stranger";
const COURSE_NAME = "Curso (procedure integration)";
const PRICE_CENTS = 3100;
const AT = new Date("2026-03-10T15:00:00.000Z");

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

let sequence = 0;
const key = () => `018f2b5c-8301-7000-8000-${String((sequence += 1)).padStart(12, "0")}`;

interface Seeded {
  studentId: string;
  enrollmentId: string;
  repository: DrizzleProcedureRepository;
}

async function rolledBack(fn: (tx: Tx, seeded: Seeded) => Promise<void>, seatStatus: "reserved" | "confirmed" = "confirmed"): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const seeded = await seed(tx, seatStatus);
      await fn(tx, seeded);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function seed(tx: Tx, seatStatus: "reserved" | "confirmed"): Promise<Seeded> {
  for (const [id, role] of [
    [REVIEWER, "billing"],
    [OWNER, "student"],
    [STRANGER, "student"],
  ] as const) {
    await tx.execute(
      sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
          values (${id}, 'Prueba', ${`${id}@test.local`}, true, ${role}, now(), now())`,
    );
  }
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (procedure integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: COURSE_NAME, language: "Prueba", minAge: 12 });
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
  await tx.insert(procedurePrices).values({ kind: "enrollment_certificate", amountCents: PRICE_CENTS, validFrom: new Date(Date.now() - 1000) });

  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Trámite",
      lastName: "Integración",
      nationalIdType: "DNI",
      nationalId: `PROC${key().slice(-8)}`,
      email: "procedure.integration@gmail.com",
      phone: "999999999",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      country: "PE",
      region: "Lima",
      city: "Lima",
      userId: OWNER,
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, seatStatus })
    .returning({ id: enrollments.id });

  return { studentId: student!.id, enrollmentId: enrollment!.id, repository: new DrizzleProcedureRepository(tx as unknown as Db) };
}

async function open({ repository, studentId, enrollmentId }: Seeded) {
  const request = await repository.open({ kind: "enrollment_certificate", studentId, enrollmentId, actorId: OWNER });
  return request!;
}

async function uploadedReceipt(tx: Tx, procedureRequestId: string, status: "uploaded" | "pending" = "uploaded"): Promise<string> {
  const [row] = await tx
    .insert(receiptUploads)
    .values({ procedureRequestId, objectKey: `receipts/raw/procedure/${procedureRequestId}/${key()}`, status })
    .returning({ id: receiptUploads.id });
  return row!.id;
}

async function pay(tx: Tx, seeded: Seeded) {
  const request = await open(seeded);
  const receiptUploadId = await uploadedReceipt(tx, request.id);
  const { paymentId } = await seeded.repository.submitPayment({
    requestId: request.id,
    receiptUploadId,
    method: "yape",
    operationNumber: `OP${key().slice(-10)}`,
    idempotencyKey: key(),
    actorId: OWNER,
  });
  return { request, receiptUploadId, paymentId };
}

const audit = (paymentId: string, action: string): AuditLogEntry => ({ actorId: REVIEWER, action, targetId: paymentId, at: AT });

const settle = (tx: Tx, paymentId: string, procedureRequestId: string, to: "approved" | "rejected") =>
  new DrizzlePaymentSettlementRepository(tx as unknown as Db).settle({
    paymentId,
    origin: { kind: "procedure", procedureRequestId },
    to,
    decision: { by: REVIEWER, at: AT, rejectionReason: to === "rejected" ? "illegible" : null },
    notifications: [],
    audit: audit(paymentId, to === "approved" ? "payment.approved" : "payment.rejected"),
    portalAccess: null,
  });

async function seat(tx: Tx, enrollmentId: string) {
  const [row] = await tx.select({ seatStatus: enrollments.seatStatus }).from(enrollments).where(eq(enrollments.id, enrollmentId));
  const [group] = await tx.select({ seatsTaken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, GROUP));
  return { seatStatus: row!.seatStatus, seatsTaken: group!.seatsTaken };
}

describe("origin of a payment (0046)", () => {
  it("refuses a payment with no origin and one with both", async () => {
    await rolledBack(async (tx, seeded) => {
      const request = await open(seeded);
      const values = { method: "yape", amountCents: 100 };
      const attempt = (extra: object) =>
        tx.transaction((inner) => inner.insert(payments).values({ ...values, idempotencyKey: key(), ...extra }));

      await expect(attempt({})).rejects.toMatchObject({ cause: { constraint: "payments_origin_check" } });
      await expect(attempt({ enrollmentId: seeded.enrollmentId, procedureRequestId: request.id })).rejects.toMatchObject({
        cause: { constraint: "payments_origin_check" },
      });
    });
  });

  it("refuses a receipt with no owner", async () => {
    await rolledBack(async (tx) => {
      await expect(
        tx.transaction((inner) => inner.insert(receiptUploads).values({ objectKey: `receipts/raw/none/${key()}` })),
      ).rejects.toMatchObject({ cause: { constraint: "receipt_uploads_owner_check" } });
    });
  });
});

describe("opening a request", () => {
  it("freezes the price in force and writes the audit entry", async () => {
    await rolledBack(async (tx, seeded) => {
      const request = await open(seeded);
      expect(request).toMatchObject({ status: "requested", amountCents: PRICE_CENTS, paymentId: null });

      // A later price does not reach it.
      await seeded.repository.addPrice({
        kind: "enrollment_certificate",
        amountCents: PRICE_CENTS + 500,
        actorId: REVIEWER,
        audit: { actorId: REVIEWER, action: "procedure_price.created", at: AT },
      });
      expect((await open(seeded)).amountCents).toBe(PRICE_CENTS);

      const [entry] = await tx.select().from(auditLog).where(eq(auditLog.targetId, request.id));
      expect(entry).toMatchObject({ action: "procedure_request.opened", actorId: OWNER });
    });
  });

  it("returns the live request instead of opening a second one", async () => {
    await rolledBack(async (tx, seeded) => {
      const first = await open(seeded);
      const second = await open(seeded);
      expect(second.id).toBe(first.id);
      const rows = await tx.select().from(procedureRequests).where(eq(procedureRequests.enrollmentId, seeded.enrollmentId));
      expect(rows).toHaveLength(1);
    });
  });

  it("opens a new request, at today's price, after a rejected one", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request, paymentId } = await pay(tx, seeded);
      await settle(tx, paymentId, request.id, "rejected");

      const again = await open(seeded);
      expect(again.id).not.toBe(request.id);
      expect(again.status).toBe("requested");
    });
  });
});

describe("who may ask", () => {
  it("finds the enrollment only for its own account and only with the seat confirmed", async () => {
    await rolledBack(async (_tx, { repository, enrollmentId, studentId }) => {
      await expect(repository.findEligibleEnrollment({ userId: OWNER, enrollmentId })).resolves.toEqual({ studentId });
      await expect(repository.findEligibleEnrollment({ userId: STRANGER, enrollmentId })).resolves.toBeNull();
    });
    await rolledBack(async (_tx, { repository, enrollmentId }) => {
      await expect(repository.findEligibleEnrollment({ userId: OWNER, enrollmentId })).resolves.toBeNull();
    }, "reserved");
  });

  it("finds a request only for its own account", async () => {
    await rolledBack(async (_tx, seeded) => {
      const request = await open(seeded);
      await expect(seeded.repository.findOwnRequest({ userId: OWNER, requestId: request.id })).resolves.toMatchObject({ id: request.id });
      await expect(seeded.repository.findOwnRequest({ userId: STRANGER, requestId: request.id })).resolves.toBeNull();
    });
  });
});

describe("submitting the payment", () => {
  it("is born pending, for the frozen amount, with the receipt linked for the pipeline", async () => {
    await rolledBack(async (tx, seeded) => {
      const { paymentId, receiptUploadId } = await pay(tx, seeded);

      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
      expect(payment).toMatchObject({ status: "pending", amountCents: PRICE_CENTS, enrollmentId: null });
      const [upload] = await tx.select().from(receiptUploads).where(eq(receiptUploads.id, receiptUploadId));
      expect(upload!.paymentId).toBe(paymentId);
    });
  });

  it("a retry with the same key returns the same payment", async () => {
    await rolledBack(async (tx, seeded) => {
      const request = await open(seeded);
      const params = {
        requestId: request.id,
        receiptUploadId: await uploadedReceipt(tx, request.id),
        method: "yape" as const,
        operationNumber: "RETRY1",
        idempotencyKey: key(),
        actorId: OWNER,
      };
      const first = await seeded.repository.submitPayment(params);
      await expect(seeded.repository.submitPayment(params)).resolves.toEqual(first);
    });
  });

  it("refuses a second payment on the same request", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request } = await pay(tx, seeded);
      await expect(
        seeded.repository.submitPayment({
          requestId: request.id,
          receiptUploadId: await uploadedReceipt(tx, request.id),
          method: "yape",
          operationNumber: "SECOND1",
          idempotencyKey: key(),
          actorId: OWNER,
        }),
      ).rejects.toBeInstanceOf(ProcedureNotPayableError);
    });
  });

  it("refuses a receipt not uploaded yet", async () => {
    await rolledBack(async (tx, seeded) => {
      const request = await open(seeded);
      await expect(
        seeded.repository.submitPayment({
          requestId: request.id,
          receiptUploadId: await uploadedReceipt(tx, request.id, "pending"),
          method: "yape",
          operationNumber: "EARLY1",
          idempotencyKey: key(),
          actorId: OWNER,
        }),
      ).rejects.toBeInstanceOf(ReceiptNotReadyError);
    });
  });

  it("refuses an operation number an enrollment already spent, per method", async () => {
    await rolledBack(async (tx, seeded) => {
      await tx.insert(payments).values({
        enrollmentId: seeded.enrollmentId,
        idempotencyKey: key(),
        method: "yape",
        amountCents: 15000,
        operationNumber: "SPENT-1",
      });
      const request = await open(seeded);
      await expect(
        seeded.repository.submitPayment({
          requestId: request.id,
          receiptUploadId: await uploadedReceipt(tx, request.id),
          method: "yape",
          operationNumber: "SPENT1",
          idempotencyKey: key(),
          actorId: OWNER,
        }),
      ).rejects.toBeInstanceOf(OperationNumberAlreadyUsedError);
    });
  });
});

describe("an operation number after a rejection", () => {
  async function rejectedFor(tx: Tx, seeded: Seeded, reason: "illegible" | "duplicate") {
    const operationNumber = `REJ${key().slice(-9)}`;
    const request = await open(seeded);
    const { paymentId } = await seeded.repository.submitPayment({
      requestId: request.id,
      receiptUploadId: await uploadedReceipt(tx, request.id),
      method: "yape",
      operationNumber,
      idempotencyKey: key(),
      actorId: OWNER,
    });
    await new DrizzlePaymentSettlementRepository(tx as unknown as Db).settle({
      paymentId,
      origin: { kind: "procedure", procedureRequestId: request.id },
      to: "rejected",
      decision: { by: REVIEWER, at: AT, rejectionReason: reason },
      notifications: [],
      audit: audit(paymentId, "payment.rejected"),
      portalAccess: null,
    });
    return operationNumber;
  }

  async function payAgain(tx: Tx, seeded: Seeded, operationNumber: string) {
    const request = await open(seeded);
    return seeded.repository.submitPayment({
      requestId: request.id,
      receiptUploadId: await uploadedReceipt(tx, request.id),
      method: "yape",
      operationNumber,
      idempotencyKey: key(),
      actorId: OWNER,
    });
  }

  it("is free again when the receipt was illegible: the student sends a better photo", async () => {
    await rolledBack(async (tx, seeded) => {
      const operationNumber = await rejectedFor(tx, seeded, "illegible");
      await expect(payAgain(tx, seeded, operationNumber)).resolves.toMatchObject({ paymentId: expect.any(String) });
    });
  });

  it("stays spent for any other reason", async () => {
    await rolledBack(async (tx, seeded) => {
      const operationNumber = await rejectedFor(tx, seeded, "duplicate");
      await expect(payAgain(tx, seeded, operationNumber)).rejects.toBeInstanceOf(OperationNumberAlreadyUsedError);
    });
  });

  it("the new request takes one payment, like any other", async () => {
    await rolledBack(async (tx, seeded) => {
      const operationNumber = await rejectedFor(tx, seeded, "illegible");
      await payAgain(tx, seeded, operationNumber);
      await expect(payAgain(tx, seeded, operationNumber)).rejects.toBeInstanceOf(ProcedureNotPayableError);
    });
  });
});

describe("settling a procedure's payment", () => {
  it("approving marks the request paid and leaves the seat alone", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request, paymentId } = await pay(tx, seeded);
      const before = await seat(tx, seeded.enrollmentId);

      const result = await settle(tx, paymentId, request.id, "approved");

      expect(result).toEqual({ seatStatus: null, portalAccess: null });
      const [row] = await tx.select().from(procedureRequests).where(eq(procedureRequests.id, request.id));
      expect(row!.status).toBe("paid");
      expect(await seat(tx, seeded.enrollmentId)).toEqual(before);
    });
  });

  it("rejecting ends the request, and the student keeps the seat: nobody loses their class over a constancia", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request, paymentId } = await pay(tx, seeded);
      const before = await seat(tx, seeded.enrollmentId);

      await settle(tx, paymentId, request.id, "rejected");

      const [row] = await tx.select().from(procedureRequests).where(eq(procedureRequests.id, request.id));
      expect(row!.status).toBe("rejected");
      expect(await seat(tx, seeded.enrollmentId)).toEqual(before);
      expect(before).toMatchObject({ seatStatus: "confirmed" });
    });
  });

  it("finds the target with its origin", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request, paymentId } = await pay(tx, seeded);
      const target = await new DrizzlePaymentSettlementRepository(tx as unknown as Db).findForSettlement(paymentId);
      expect(target).toMatchObject({
        studentId: seeded.studentId,
        classGroupId: GROUP,
        origin: { kind: "procedure", procedureRequestId: request.id },
      });
    });
  });
});

describe("the receipt pipeline, on a procedure's payment", () => {
  it("the screening finds who to write to, through the enrollment the request refers to", async () => {
    await rolledBack(async (tx, seeded) => {
      const { paymentId, receiptUploadId } = await pay(tx, seeded);
      await tx
        .update(receiptUploads)
        .set({ status: "processed", processedObjectKey: `receipts/processed/procedure/${receiptUploadId}.jpg` })
        .where(eq(receiptUploads.id, receiptUploadId));

      const subject = await new DrizzleReceiptScreeningRepository(tx as unknown as Db).findSubject(receiptUploadId);

      expect(subject).toMatchObject({ paymentId, studentId: seeded.studentId, classGroupId: GROUP, isProcedure: true });
    });
  });

  it("the traffic light checks against the frozen amount, and a yellow only routes the payment", async () => {
    await rolledBack(async (tx, seeded) => {
      const { request, paymentId, receiptUploadId } = await pay(tx, seeded);
      await tx
        .update(receiptUploads)
        .set({ status: "processed", processedObjectKey: `receipts/processed/procedure/${receiptUploadId}.jpg`, screenedAt: AT })
        .where(eq(receiptUploads.id, receiptUploadId));
      await tx.insert(paymentReceipts).values({ paymentId, receiptUploadId, tier: 1, amountCents: 100, extractedFields: [] });

      const repository = new DrizzleReceiptValidationRepository(tx as unknown as Db);
      const subject = await repository.findSubject(receiptUploadId);
      expect(subject).toMatchObject({ expectedCents: PRICE_CENTS, readAmountCents: 100, studentId: seeded.studentId, isProcedure: true });

      const effect = await repository.record({
        subject: subject!,
        outcome: { verdict: "reject_suggested", reason: "far_below" },
        detail: {
          reason: "far_below",
          expectedCents: PRICE_CENTS,
          readAmountCents: 100,
          toleranceCents: 0,
          rejectBelowPercent: 50,
        } as never,
        notifications: [],
      });

      expect(effect).toBe("routed_to_review");
      const [payment] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
      expect(payment!.status).toBe("under_review");
      // Nothing about the request moves until a person decides.
      const [row] = await tx.select({ status: procedureRequests.status }).from(procedureRequests).where(eq(procedureRequests.id, request.id));
      expect(row!.status).toBe("requested");
    });
  });
});

describe("Payments, with both origins side by side", () => {
  async function both(tx: Tx, seeded: Seeded) {
    const { paymentId: procedurePayment } = await pay(tx, seeded);
    const [enrollmentPayment] = await tx
      .insert(payments)
      .values({ enrollmentId: seeded.enrollmentId, idempotencyKey: key(), method: "yape", amountCents: 15000 })
      .returning({ id: payments.id });
    return { procedurePayment, enrollmentPayment: enrollmentPayment!.id };
  }

  it("the ledger lists both, each with what it is for and what it was checked against", async () => {
    await rolledBack(async (tx, seeded) => {
      const { procedurePayment, enrollmentPayment } = await both(tx, seeded);

      const result = await new ListPaymentsQuery(tx as unknown as Db).run({ q: COURSE_NAME });

      const byId = new Map(result.items.map((item) => [item.id, item]));
      expect(byId.get(procedurePayment)).toMatchObject({
        procedureKind: "enrollment_certificate",
        expectedAmountCents: PRICE_CENTS,
        enrollmentId: seeded.enrollmentId,
        courseName: COURSE_NAME,
      });
      // Regression: an enrollment's payment reads as it always did.
      expect(byId.get(enrollmentPayment)).toMatchObject({
        procedureKind: null,
        expectedAmountCents: 15000,
        enrollmentId: seeded.enrollmentId,
      });
      expect(result.total).toBe(2);
    });
  });

  it("the review queue lists both", async () => {
    await rolledBack(async (tx, seeded) => {
      const { procedurePayment, enrollmentPayment } = await both(tx, seeded);
      const settings = new DrizzlePlatformSettingsRepository(tx as unknown as Db);

      const queue = await new ListPaymentReviewQueueQuery(tx as unknown as Db, settings).run({ q: COURSE_NAME });

      const byId = new Map(queue.items.map((item) => [item.id, item]));
      expect(byId.get(procedurePayment)).toMatchObject({ procedureKind: "enrollment_certificate", expectedAmountCents: PRICE_CENTS });
      expect(byId.get(enrollmentPayment)).toMatchObject({ procedureKind: null, expectedAmountCents: 15000 });
      expect(queue.total).toBe(2);
    });
  });
});
