import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import {
  Enrollment,
  OperationNumberAlreadyUsedError,
  Payment,
  Student,
  type SubmitPublicEnrollmentParams,
} from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzlePublicEnrollmentRepository } from "./DrizzlePublicEnrollmentRepository.js";
import { DrizzleSeatHoldRepository } from "./DrizzleSeatHoldRepository.js";

/**
 * The public submit in SQL. It used to require a verified e-mail proof for the
 * hold (spec 2026-10-07); since OOC-141 (06/11/2026) it enrolls without one,
 * and a refusal inside the transaction still writes nothing.
 *
 * Runs with `pnpm test:api:db`. Every test runs inside one transaction that is
 * always rolled back — the repository's own transaction nests as a savepoint —
 * because `students` and `payments` cannot be deleted (CLAUDE.md §6).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises DrizzlePublicEnrollmentRepository against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-7200-7000-8000-000000000001";
const COURSE = "018f2b5c-7200-7000-8000-000000000002";
const PLAN = "018f2b5c-7200-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-7200-7000-8000-000000000004";
const GROUP = "018f2b5c-7200-7000-8000-000000000005";
const OTHER_STUDENT = "018f2b5c-7200-7000-8000-000000000006";
const OTHER_ENROLLMENT = "018f2b5c-7200-7000-8000-000000000007";
const EMAIL = "submit.integration@gmail.com";

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

/** Runs `fn` against a transaction that never commits. */
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

/** A class group on sale, a live hold on it and an uploaded receipt for the hold. */
async function seed(tx: Db): Promise<{ holdId: string; receiptUploadId: string }> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (public submit integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (public submit)", language: "Lengua de prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({
    id: PLAN_PRICE,
    planId: PLAN,
    amountCents: 25000,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
  });
  await tx.insert(classGroups).values({
    id: GROUP,
    status: "enrolling",
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 5,
  });
  const claimed = await new DrizzleSeatHoldRepository(tx).claim({ classGroupId: GROUP, origin: "web", holdMinutes: 15 });
  if (claimed.kind !== "held") throw new Error("fixture hold not taken");
  const holdId = claimed.hold.id;
  const [upload] = await tx
    .insert(receiptUploads)
    .values({ seatHoldId: holdId, objectKey: `receipts/public-submit-integration/${holdId}`, status: "uploaded" })
    .returning({ id: receiptUploads.id });
  return { holdId, receiptUploadId: upload!.id };
}

function submitParams(holdId: string, receiptUploadId: string, operationNumber = "99900001"): SubmitPublicEnrollmentParams {
  const student = Student.create({
    firstName: "Rosa",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "70000272",
    email: EMAIL,
    phone: "+51987654321",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    region: "Lima",
    city: "Lima",
  });
  const enrollment = Enrollment.createFromPublicCheckout({
    studentId: student.id,
    classGroupId: GROUP,
    planPriceId: PLAN_PRICE,
    origin: "web",
  });
  const payment = Payment.createFromPublicCheckout({
    enrollmentId: enrollment.id,
    idempotencyKey: `public-submit-integration-${holdId}`,
    method: "yape",
    methodDetail: null,
    amountCents: 25000,
    operationNumber,
  });
  return { seatHoldId: holdId, student, guardian: null, consent: null, enrollment, payment, receiptUploadId, notifications: [] };
}

async function holdStatus(tx: Db, holdId: string): Promise<string> {
  const [row] = await tx.select({ status: seatHolds.status }).from(seatHolds).where(eq(seatHolds.id, holdId));
  return row!.status;
}

describe("DrizzlePublicEnrollmentRepository.submit", () => {
  it("enrolls without an e-mail proof, consuming the hold", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { holdId, receiptUploadId } = await seed(tx);
      const params = submitParams(holdId, receiptUploadId);

      const result = await new DrizzlePublicEnrollmentRepository(tx).submit(params);

      expect(result.enrollment.id).toBe(params.enrollment.id);
      expect(await holdStatus(tx, holdId)).toBe("consumed");
    });
  });

  it("writes nothing when a check inside the transaction refuses", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { holdId, receiptUploadId } = await seed(tx);
      // Somebody else already spent this operation number.
      await tx.insert(students).values({
        id: OTHER_STUDENT,
        firstName: "Luis",
        lastName: "Ramos",
        nationalIdType: "DNI",
        nationalId: "70000273",
        email: "luis.submit.integration@gmail.com",
        phone: "+51987654322",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        country: "PE",
        city: "Lima",
      });
      await tx.insert(enrollments).values({
        id: OTHER_ENROLLMENT,
        studentId: OTHER_STUDENT,
        classGroupId: GROUP,
        planPriceId: PLAN_PRICE,
        seatStatus: "reserved",
        origin: "web",
      });
      await tx.insert(payments).values({
        enrollmentId: OTHER_ENROLLMENT,
        idempotencyKey: "public-submit-integration-other",
        status: "pending",
        method: "yape",
        amountCents: 25000,
        operationNumber: "99900002",
      });

      const params = submitParams(holdId, receiptUploadId, "99900002");
      await expect(new DrizzlePublicEnrollmentRepository(tx).submit(params)).rejects.toBeInstanceOf(OperationNumberAlreadyUsedError);

      expect(await tx.select().from(enrollments).where(eq(enrollments.id, params.enrollment.id))).toHaveLength(0);
      expect(await tx.select().from(students).where(eq(students.id, params.student.id))).toHaveLength(0);
      expect(await holdStatus(tx, holdId)).toBe("active");
    });
  });
});
