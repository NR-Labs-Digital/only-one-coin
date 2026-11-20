import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroupModules,
  classGroups,
  courses,
  enrollments,
  paymentModules,
  payments,
  planPrices,
  plans,
  receiptUploads,
  students,
} from "@ooc/db";
import {
  MonthlyModulesNotForSaleError,
  ReceiptNotReadyError,
  approvedEmailsFor,
  monthlyReceiptObjectKey,
} from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEnrollmentEmailContextLookup } from "@/infra/persistence/enrollment/DrizzleEnrollmentEmailContextLookup.js";
import { DrizzlePaymentEmailContextLookup } from "@/infra/persistence/enrollment/DrizzlePaymentEmailContextLookup.js";
import { StudentPortalQuery } from "@/infra/persistence/portal/StudentPortalQuery.js";
import { GetStudentQuery } from "@/infra/persistence/student/GetStudentQuery.js";
import { DrizzleMonthlyPaymentRepository } from "./DrizzleMonthlyPaymentRepository.js";
import { ListPaymentsQuery } from "./ListPaymentsQuery.js";

/**
 * Monthly modules bought from the portal (OOC-86), against the real SQL: what
 * is for sale, the prefix, today's price, the class lock in the portal, the
 * module e-mails and what Payments expects. Every test runs in a transaction
 * that is always rolled back: `payments` and `students` are under the delete
 * lock (0011).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the monthly payment SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-8600-7000-8000-000000000001";
const COURSE = "018f2b5c-8600-7000-8000-000000000002";
const PLAN = "018f2b5c-8600-7000-8000-000000000003";
const ENTRY_PRICE = "018f2b5c-8600-7000-8000-000000000004";
const GROUP = "018f2b5c-8600-7000-8000-000000000005";
const RUN_2 = "018f2b5c-8600-7000-8000-000000000006";
const OWNER = "usr_monthly_student";
const STRANGER = "usr_monthly_stranger";
const COURSE_NAME = "Inglés (monthly integration)";
const ENTRY_CENTS = 10000;
const TODAY_CENTS = 12000;

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
const key = () => `018f2b5c-8601-7000-8000-${String((sequence += 1)).padStart(12, "0")}`;

interface Seeded {
  enrollmentId: string;
  entryPaymentId: string;
  repository: DrizzleMonthlyPaymentRepository;
}

async function rolledBack(fn: (tx: Tx, seeded: Seeded) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx, await seed(tx));
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/**
 * A three-module monthly course: the student entered module 1, the first
 * purchase (module 1) is approved, and the price went up since.
 */
async function seed(tx: Tx): Promise<Seeded> {
  for (const id of [OWNER, STRANGER]) {
    await tx.execute(
      sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
          values (${id}, 'Prueba', ${`${id}@test.local`}, true, 'student', now(), now())`,
    );
  }
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (monthly integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: COURSE_NAME, language: "Inglés", minAge: 12, modules: 3 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Mensual", billing: "monthly" });
  await tx.insert(planPrices).values([
    { id: ENTRY_PRICE, planId: PLAN, amountCents: ENTRY_CENTS, validFrom: new Date(Date.now() - 10 * 86_400_000) },
    { planId: PLAN, amountCents: TODAY_CENTS, validFrom: new Date(Date.now() - 1000) },
  ]);
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 30,
    seatsTaken: 1,
    status: "in_progress",
  });
  await tx.insert(classGroupModules).values([
    { id: GROUP, classGroupId: GROUP, module: 1, meetUrl: "https://meet.google.com/aaa-bbbb-ccc" },
    { id: RUN_2, classGroupId: GROUP, module: 2, meetUrl: "https://meet.google.com/ddd-eeee-fff" },
  ]);

  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Mensual",
      lastName: "Integración",
      nationalIdType: "DNI",
      nationalId: `MONTH${key().slice(-8)}`,
      email: "monthly.integration@gmail.com",
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
    .values({ studentId: student!.id, classGroupId: GROUP, classGroupModuleId: GROUP, planPriceId: ENTRY_PRICE, seatStatus: "confirmed" })
    .returning({ id: enrollments.id });
  const [entry] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: key(),
      method: "yape",
      amountCents: ENTRY_CENTS,
      status: "approved",
      decidedAt: new Date(Date.now() - 5 * 86_400_000),
      createdAt: new Date(Date.now() - 6 * 86_400_000),
    })
    .returning({ id: payments.id });
  await tx.insert(paymentModules).values({ paymentId: entry!.id, enrollmentId: enrollment!.id, module: 1, attempt: 1 });

  return {
    enrollmentId: enrollment!.id,
    entryPaymentId: entry!.id,
    repository: new DrizzleMonthlyPaymentRepository(tx as unknown as Db),
  };
}

async function uploadedReceipt(tx: Tx, enrollmentId: string, owner = OWNER): Promise<string> {
  const id = key();
  await tx
    .insert(receiptUploads)
    .values({ id, uploadedBy: owner, objectKey: monthlyReceiptObjectKey(enrollmentId, id), status: "uploaded" });
  return id;
}

async function buy(tx: Tx, seeded: Seeded, moduleCount: number) {
  return seeded.repository.submitPayment({
    enrollmentId: seeded.enrollmentId,
    receiptUploadId: await uploadedReceipt(tx, seeded.enrollmentId),
    userId: OWNER,
    method: "yape",
    operationNumber: `OP${key().slice(-10)}`,
    moduleCount,
    idempotencyKey: key(),
  });
}

/** The student moves on to module 2, as progression does. */
async function enterModule2(tx: Tx, enrollmentId: string) {
  await tx.update(enrollments).set({ classGroupModuleId: RUN_2, moduleAttempt: 1 }).where(eq(enrollments.id, enrollmentId));
}

const overview = (tx: Tx) => new StudentPortalQuery(tx as unknown as Db, new GetStudentQuery(tx as unknown as Db)).overview(OWNER);

describe("monthly modules bought from the portal (OOC-86)", { timeout: 30_000 }, () => {
  it("finds only an enrollment the account reaches", async () => {
    await rolledBack(async (_tx, seeded) => {
      expect(await seeded.repository.findOwnEnrollment({ userId: OWNER, enrollmentId: seeded.enrollmentId })).not.toBeNull();
      expect(await seeded.repository.findOwnEnrollment({ userId: STRANGER, enrollmentId: seeded.enrollmentId })).toBeNull();
    });
  });

  it("buys the next modules ahead as a prefix, at today's price", async () => {
    await rolledBack(async (tx, seeded) => {
      const bought = await buy(tx, seeded, 2);

      expect(bought.modules).toEqual([
        { module: 2, attempt: 1 },
        { module: 3, attempt: 1 },
      ]);
      expect(bought.amountCents).toBe(2 * TODAY_CENTS);
      const [row] = await tx.select().from(payments).where(eq(payments.id, bought.paymentId));
      expect(row).toMatchObject({ status: "pending", enrollmentId: seeded.enrollmentId, amountCents: 2 * TODAY_CENTS });
    });
  });

  it("refuses more modules than are for sale, and what is already bought", async () => {
    await rolledBack(async (tx, seeded) => {
      await expect(buy(tx, seeded, 3)).rejects.toBeInstanceOf(MonthlyModulesNotForSaleError);
      await buy(tx, seeded, 2);
      await expect(buy(tx, seeded, 1)).rejects.toBeInstanceOf(MonthlyModulesNotForSaleError);
    });
  });

  it("a rejected purchase puts the modules on sale again", async () => {
    await rolledBack(async (tx, seeded) => {
      const first = await buy(tx, seeded, 1);
      await tx.update(payments).set({ status: "rejected", decidedAt: sql`now()` }).where(eq(payments.id, first.paymentId));

      const again = await buy(tx, seeded, 1);
      expect(again.modules).toEqual([{ module: 2, attempt: 1 }]);
    });
  });

  it("a retry with the same key returns the first payment", async () => {
    await rolledBack(async (tx, seeded) => {
      const params = {
        enrollmentId: seeded.enrollmentId,
        receiptUploadId: await uploadedReceipt(tx, seeded.enrollmentId),
        userId: OWNER,
        method: "yape" as const,
        operationNumber: "OPRETRY0001",
        moduleCount: 1,
        idempotencyKey: key(),
      };
      const first = await seeded.repository.submitPayment(params);
      const second = await seeded.repository.submitPayment(params);
      expect(second).toEqual(first);
    });
  });

  it("refuses a receipt uploaded by another account", async () => {
    await rolledBack(async (tx, seeded) => {
      const strangers = await uploadedReceipt(tx, seeded.enrollmentId, STRANGER);
      await expect(
        seeded.repository.submitPayment({
          enrollmentId: seeded.enrollmentId,
          receiptUploadId: strangers,
          userId: OWNER,
          method: "yape",
          operationNumber: "OPSTRANGER1",
          moduleCount: 1,
          idempotencyKey: key(),
        }),
      ).rejects.toBeInstanceOf(ReceiptNotReadyError);
    });
  });

  it("the portal locks the class of a module not bought, and opens it once approved", async () => {
    await rolledBack(async (tx, seeded) => {
      let view = await overview(tx);
      let enrollment = view!.enrollments.find((item) => item.id === seeded.enrollmentId)!;
      // Module 1 bought and approved: open.
      expect(enrollment.monthly).toMatchObject({ current: { module: 1, attempt: 1 }, lock: null, modulePriceCents: TODAY_CENTS });
      expect(enrollment.classGroup.meetUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");

      await enterModule2(tx, seeded.enrollmentId);
      view = await overview(tx);
      enrollment = view!.enrollments.find((item) => item.id === seeded.enrollmentId)!;
      expect(enrollment.monthly).toMatchObject({ current: { module: 2, attempt: 1 }, lock: "monthly_payment_due" });
      expect(enrollment.monthly!.forSale).toEqual([
        { module: 2, attempt: 1 },
        { module: 3, attempt: 1 },
      ]);
      expect(enrollment.classGroup.meetUrl).toBeNull();
      expect(enrollment.classGroup.classroomLinks).toEqual([]);

      const bought = await buy(tx, seeded, 1);
      view = await overview(tx);
      enrollment = view!.enrollments.find((item) => item.id === seeded.enrollmentId)!;
      // Waiting for a person is still closed (decision of 20/11/2026).
      expect(enrollment.monthly!.lock).toBe("monthly_payment_in_review");
      expect(enrollment.classGroup.meetUrl).toBeNull();

      await tx.update(payments).set({ status: "approved", decidedAt: sql`now()` }).where(eq(payments.id, bought.paymentId));
      view = await overview(tx);
      enrollment = view!.enrollments.find((item) => item.id === seeded.enrollmentId)!;
      expect(enrollment.monthly!.lock).toBeNull();
      expect(enrollment.classGroup.meetUrl).toBe("https://meet.google.com/ddd-eeee-fff");
    });
  });

  it("repeating a module closes the class again: the new attempt is bought anew", async () => {
    await rolledBack(async (tx, seeded) => {
      await tx.update(enrollments).set({ moduleAttempt: 2 }).where(eq(enrollments.id, seeded.enrollmentId));
      const view = await overview(tx);
      const enrollment = view!.enrollments.find((item) => item.id === seeded.enrollmentId)!;
      expect(enrollment.monthly).toMatchObject({ current: { module: 1, attempt: 2 }, lock: "monthly_payment_due" });
      expect(enrollment.monthly!.forSale[0]).toEqual({ module: 1, attempt: 2 });
    });
  });

  it("a later purchase speaks about its modules; the entry payment about the seat", async () => {
    await rolledBack(async (tx, seeded) => {
      const lookup = new DrizzlePaymentEmailContextLookup(
        tx as unknown as Db,
        new DrizzleEnrollmentEmailContextLookup(tx as unknown as Db),
      );
      const bought = await buy(tx, seeded, 2);

      const later = await lookup.find(bought.paymentId);
      expect(later?.modules).toEqual([2, 3]);
      expect(approvedEmailsFor(later!, "es-PE").map((email) => email.templateKey)).toEqual(["monthly_payment_approved"]);

      const entry = await lookup.find(seeded.entryPaymentId);
      expect(entry?.modules).toBeNull();
      expect(approvedEmailsFor(entry!, "es-PE").map((email) => email.templateKey)).toEqual(["payment_approved"]);
    });
  });

  it("Payments expects what the purchase charged, and lists its modules", async () => {
    await rolledBack(async (tx, seeded) => {
      const bought = await buy(tx, seeded, 2);
      const query = new ListPaymentsQuery(tx as unknown as Db);
      const [open, closed] = await Promise.all([
        query.run({ q: COURSE_NAME, state: "open" }),
        query.run({ q: COURSE_NAME, state: "closed" }),
      ]);
      const byId = new Map([...open.items, ...closed.items].map((row) => [row.id, row]));

      expect(byId.get(bought.paymentId)).toMatchObject({ expectedAmountCents: 2 * TODAY_CENTS, monthlyModules: [2, 3] });
      expect(byId.get(seeded.entryPaymentId)).toMatchObject({ expectedAmountCents: ENTRY_CENTS, monthlyModules: null });
    });
  });
});
