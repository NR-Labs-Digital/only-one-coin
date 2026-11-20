import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  paymentLotEnrollments,
  paymentReceipts,
  payments,
  planPrices,
  plans,
  procedurePrices,
  procedureRequests,
  receiptRereads,
  receiptUploads,
  students,
} from "@ooc/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";
import { StudentPaymentsQuery } from "./StudentPaymentsQuery.js";

/**
 * The receipts block of the student file (OOC-62). What has to hold is the
 * SQL the type checker cannot see: which payments are this student's (their
 * own, a lot paid on a sibling's enrollment, a procedure of theirs — never
 * someone else's), which upload and which reading speak for a payment, and
 * what a lot is expected to bring in.
 *
 * Every test runs in a transaction that is always rolled back (the delete
 * lock, 0011).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the student payments SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-9100-7000-8000-000000000001";
const COURSE_A = "018f2b5c-9100-7000-8000-000000000002";
const COURSE_B = "018f2b5c-9100-7000-8000-000000000003";
const PLAN_A = "018f2b5c-9100-7000-8000-000000000004";
const PLAN_B = "018f2b5c-9100-7000-8000-000000000005";
const PRICE_A = "018f2b5c-9100-7000-8000-000000000006";
const PRICE_B = "018f2b5c-9100-7000-8000-000000000007";
const GROUP_A = "018f2b5c-9100-7000-8000-000000000008";
const GROUP_B = "018f2b5c-9100-7000-8000-000000000009";
const READER = "usr_student_payments_reader";

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
    name: "Ciclo de prueba (student payments integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values([
    { id: COURSE_A, name: "Curso A (student payments)", language: "Prueba", minAge: 12 },
    { id: COURSE_B, name: "Curso B (student payments)", language: "Prueba", minAge: 12 },
  ]);
  await tx.insert(plans).values([
    { id: PLAN_A, courseId: COURSE_A, name: "Paquete A" },
    { id: PLAN_B, courseId: COURSE_B, name: "Paquete B" },
  ]);
  await tx.insert(planPrices).values([
    { id: PRICE_A, planId: PLAN_A, amountCents: 15000 },
    { id: PRICE_B, planId: PLAN_B, amountCents: 9000 },
  ]);
  const group = {
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 50,
    seatsTaken: 3,
  };
  await tx.insert(classGroups).values([
    { id: GROUP_A, courseId: COURSE_A, ...group },
    { id: GROUP_B, courseId: COURSE_B, ...group },
  ]);
  await seedModuleRuns(tx);
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role") values (${READER}, 'Revisor', 'usr_student_payments_reader@example.com', true, 'billing')`,
  );
}

let sequence = 0;

async function student(tx: Tx, tag: string): Promise<string> {
  const stamp = `${Date.now()}${sequence++}`;
  const [row] = await tx
    .insert(students)
    .values({
      firstName: "Pago",
      lastName: `Ficha ${tag}`,
      nationalIdType: "DNI",
      nationalId: `STPAY${stamp}`,
      email: `stpay.${stamp}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  return row!.id;
}

async function enrollment(tx: Tx, studentId: string, course: "A" | "B", deletedAt: Date | null = null): Promise<string> {
  const [row] = await tx
    .insert(enrollments)
    .values({
      studentId,
      classGroupId: course === "A" ? GROUP_A : GROUP_B,
      planPriceId: course === "A" ? PRICE_A : PRICE_B,
      seatStatus: "reserved",
      deletedAt,
    })
    .returning({ id: enrollments.id });
  return row!.id;
}

async function payment(
  tx: Tx,
  origin: { enrollmentId: string } | { procedureRequestId: string },
  values: { status?: string; amountCents?: number; minutesAgo: number; rejectionReason?: string },
): Promise<string> {
  const createdAt = new Date(Date.now() - values.minutesAgo * 60_000);
  const status = values.status ?? "pending";
  const decided = status === "approved" || status === "rejected";
  const [row] = await tx
    .insert(payments)
    .values({
      ...origin,
      idempotencyKey: `student-payments-integration-${Date.now()}-${sequence++}`,
      status,
      method: "yape",
      amountCents: values.amountCents ?? 15000,
      operationNumber: `STPAYOP${sequence}`,
      createdAt,
      updatedAt: createdAt,
      decidedAt: decided ? new Date(createdAt.getTime() + 30_000) : null,
      rejectionReason: values.rejectionReason ?? null,
    })
    .returning({ id: payments.id });
  return row!.id;
}

/** A processed receipt on the payment, judged and read at level 1. */
async function receipt(
  tx: Tx,
  paymentId: string,
  params: { amountCents: number; verdict: "approve" | "review" | "reject_suggested"; minutesAgo: number },
): Promise<string> {
  const at = new Date(Date.now() - params.minutesAgo * 60_000);
  const [upload] = await tx
    .insert(receiptUploads)
    .values({
      uploadedBy: READER,
      paymentId,
      objectKey: `receipts/student-payments-integration/${paymentId}/${sequence++}/raw.jpg`,
      processedObjectKey: `receipts/student-payments-integration/${paymentId}/${sequence}/processed.jpg`,
      status: "processed",
      validationVerdict: params.verdict,
      validationDetail: { reason: "exact" },
      validatedAt: at,
      createdAt: at,
    })
    .returning({ id: receiptUploads.id });
  await tx.insert(paymentReceipts).values({
    paymentId,
    receiptUploadId: upload!.id,
    tier: 1,
    modelName: "google/gemini-3.1-flash-lite",
    amountCents: params.amountCents,
  });
  return upload!.id;
}

function query(tx: Tx): StudentPaymentsQuery {
  return new StudentPaymentsQuery(tx as unknown as Db);
}

describe("StudentPaymentsQuery", () => {
  it("lists the student's own payment, a lot paid on a sibling's enrollment and a procedure — newest first, nobody else's", async () => {
    await rolledBack(async (tx) => {
      const me = await student(tx, "me");
      const sibling = await student(tx, "sibling");
      const stranger = await student(tx, "stranger");

      const mine = await enrollment(tx, me, "A");
      const mineInLot = await enrollment(tx, me, "B");
      const siblingsInLot = await enrollment(tx, sibling, "A");
      const strangers = await enrollment(tx, stranger, "A");

      const own = await payment(tx, { enrollmentId: mine }, { status: "approved", minutesAgo: 30 });
      // The lot's payment hangs off the sibling's enrollment; this student is
      // only in payment_lot_enrollments.
      const lot = await payment(
        tx,
        { enrollmentId: siblingsInLot },
        { status: "rejected", amountCents: 24000, minutesAgo: 20, rejectionReason: "illegible" },
      );
      await tx.insert(paymentLotEnrollments).values({ paymentId: lot, enrollmentId: mineInLot });

      const [price] = await tx
        .insert(procedurePrices)
        .values({ kind: "enrollment_certificate", amountCents: 2500 })
        .returning({ id: procedurePrices.id });
      const [request] = await tx
        .insert(procedureRequests)
        .values({ kind: "enrollment_certificate", studentId: me, enrollmentId: mine, procedurePriceId: price!.id, amountCents: 2500 })
        .returning({ id: procedureRequests.id });
      const procedure = await payment(tx, { procedureRequestId: request!.id }, { amountCents: 2500, minutesAgo: 10 });

      await payment(tx, { enrollmentId: strangers }, { minutesAgo: 5 });

      const rows = await query(tx).run(me);

      expect(rows.map((row) => row.id)).toEqual([procedure, lot, own]);

      const [procedureRow, lotRow, ownRow] = rows;
      expect(procedureRow).toMatchObject({
        procedureKind: "enrollment_certificate",
        courseNames: ["Curso A (student payments)"],
        enrollmentCount: 1,
        expectedAmountCents: 2500,
        status: "pending",
        hasReceipt: false,
        readAmountCents: null,
        verdict: null,
      });
      expect(lotRow).toMatchObject({
        procedureKind: null,
        // Only this student's course in the lot, not the sibling's.
        courseNames: ["Curso B (student payments)"],
        enrollmentCount: 2,
        expectedAmountCents: 24000,
        status: "rejected",
        rejectionReason: "illegible",
      });
      expect(lotRow!.decidedAt).not.toBeNull();
      expect(ownRow).toMatchObject({ procedureKind: null, expectedAmountCents: 15000, status: "approved", rejectionReason: null });

      // The sibling sees the same lot, with their own course.
      const siblingRows = await query(tx).run(sibling);
      expect(siblingRows).toHaveLength(1);
      expect(siblingRows[0]).toMatchObject({ id: lot, courseNames: ["Curso A (student payments)"] });
    });
  });

  it("reads the latest upload, and its answered re-read over the first reading", async () => {
    await rolledBack(async (tx) => {
      const me = await student(tx, "reader");
      const mine = await enrollment(tx, me, "A");
      const id = await payment(tx, { enrollmentId: mine }, { status: "under_review", minutesAgo: 30 });

      await receipt(tx, id, { amountCents: 100, verdict: "reject_suggested", minutesAgo: 25 });
      const latest = await receipt(tx, id, { amountCents: 14000, verdict: "review", minutesAgo: 20 });

      const [first] = await query(tx).run(me);
      expect(first).toMatchObject({ hasReceipt: true, readAmountCents: 14000, verdict: "review" });

      await tx.insert(receiptRereads).values({
        paymentId: id,
        receiptUploadId: latest,
        requestedBy: READER,
        tier: 1,
        amountCents: 15000,
        validationVerdict: "approve",
        validationDetail: { reason: "exact" },
        readAt: new Date(),
      });
      // A re-read still with the model does not speak.
      await tx.insert(receiptRereads).values({ paymentId: id, receiptUploadId: latest, requestedBy: READER, tier: 1 });

      const [reread] = await query(tx).run(me);
      expect(reread).toMatchObject({ readAmountCents: 15000, verdict: "approve" });
    });
  });

  it("leaves out the payments of a retired enrollment", async () => {
    await rolledBack(async (tx) => {
      const me = await student(tx, "retired");
      const retired = await enrollment(tx, me, "A", new Date());
      await payment(tx, { enrollmentId: retired }, { minutesAgo: 5 });

      expect(await query(tx).run(me)).toEqual([]);
    });
  });
});
