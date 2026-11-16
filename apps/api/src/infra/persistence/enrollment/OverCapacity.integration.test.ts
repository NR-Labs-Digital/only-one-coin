import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  enrollments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import {
  ClassGroupFullError,
  Enrollment,
  EnrollmentMoveRefusedError,
  MoveEnrollmentUseCase,
  Payment,
  SeatHoldExpiredError,
  type SeatPlacement,
  Student,
  type SubmitPublicEnrollmentParams,
} from "@ooc/domain";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleAuditLogRepository } from "@/infra/identity/DrizzleAuditLogRepository.js";
import { GetPublicCatalogQuery } from "@/infra/persistence/catalog/GetPublicCatalogQuery.js";
import { DrizzlePaymentSettlementRepository } from "@/infra/persistence/payment/DrizzlePaymentSettlementRepository.js";
import { seedManualReceipt } from "@/tests/fixtures/manualReceipt.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";
import { DrizzleEnrollmentMoveRepository } from "./DrizzleEnrollmentMoveRepository.js";
import { DrizzleEnrollmentRepository } from "./DrizzleEnrollmentRepository.js";
import { DrizzlePlanPriceLookup } from "./DrizzlePlanPriceLookup.js";
import { DrizzlePublicEnrollmentRepository } from "./DrizzlePublicEnrollmentRepository.js";
import { DrizzleSeatHoldRepository } from "./DrizzleSeatHoldRepository.js";

/**
 * Seats above capacity (OOC-155) and the staff move (OOC-84), in SQL:
 *
 * - an expired checkout hold that comes back paid gets a regular seat if the
 *   schedule still has one, and one above capacity if not;
 * - the manual enrollment and the move go above capacity only when asked;
 * - every seat given back returns to the counter it came from, and a class
 *   group above capacity never shows room again when a regular seat frees up.
 *
 * Runs with `pnpm test:api:db`, each test inside a transaction that is always
 * rolled back (students and payments cannot be deleted — CLAUDE.md §6).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the seat counters against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-8155-7000-8000-000000000001";
const COURSE = "018f2b5c-8155-7000-8000-000000000002";
const PLAN = "018f2b5c-8155-7000-8000-000000000003";
const PRICE = "018f2b5c-8155-7000-8000-000000000004";
const OTHER_COURSE = "018f2b5c-8155-7000-8000-000000000005";
const OTHER_PLAN = "018f2b5c-8155-7000-8000-000000000006";
const OTHER_PRICE = "018f2b5c-8155-7000-8000-000000000007";
const GROUP_A = "018f2b5c-8155-7000-8000-000000000011";
const GROUP_B = "018f2b5c-8155-7000-8000-000000000012";
const GROUP_OTHER_COURSE = "018f2b5c-8155-7000-8000-000000000013";
const ROSA = "018f2b5c-8155-7000-8000-000000000021";
const JUAN = "018f2b5c-8155-7000-8000-000000000022";
const PEDRO = "018f2b5c-8155-7000-8000-000000000023";
/** Same course, another week: where a student starts before moving onto the A/B schedule. */
const GROUP_D = "018f2b5c-8155-7000-8000-000000000014";
const STAFF = "ooc-155-staff";
const SLOTS = [{ weekday: "tue", startTime: "18:00", endTime: "19:30" }];

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

/**
 * Two class groups of the same schedule (A fills before B) with one seat each
 * unless said otherwise, and a third of another course.
 */
async function seed(tx: Db, opts: { siblings: boolean } = { siblings: false }): Promise<void> {
  const now = Date.now();
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (over capacity integration)",
    startsOn: new Date(now - 30 * DAY),
    endsOn: new Date(now + 90 * DAY),
  });
  await tx.insert(courses).values([
    { id: COURSE, name: "Curso (over capacity)", language: "Lengua de prueba", minAge: 12 },
    { id: OTHER_COURSE, name: "Otro curso (over capacity)", language: "Lengua de prueba", minAge: 12 },
  ]);
  await tx.insert(plans).values([
    { id: PLAN, courseId: COURSE, name: "Paquete (over capacity)" },
    { id: OTHER_PLAN, courseId: OTHER_COURSE, name: "Paquete otro (over capacity)" },
  ]);
  await tx.insert(planPrices).values([
    { id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) },
    { id: OTHER_PRICE, planId: OTHER_PLAN, amountCents: 12900, validFrom: new Date(now - DAY) },
  ]);
  const startsOn = new Date(now + 7 * DAY);
  const endsOn = new Date(now + 60 * DAY);
  const group = (id: string, code: string, courseId: string, slots = SLOTS) => ({
    id,
    courseId,
    academicPeriodId: PERIOD,
    schedule: "",
    slots,
    code,
    startsOn,
    endsOn,
    capacity: 1,
    seatsTaken: 0,
    status: "enrolling",
  });
  await tx.insert(classGroups).values([
    group(GROUP_A, "A-OC-1", COURSE),
    // Not a sibling unless asked: another week makes it another schedule.
    group(GROUP_B, "A-OC-2", COURSE, opts.siblings ? SLOTS : [{ weekday: "sat", startTime: "09:00", endTime: "10:30" }]),
    group(GROUP_OTHER_COURSE, "A-OC-3", OTHER_COURSE),
  ]);
  await seedModuleRuns(tx);
  await tx.insert(students).values([studentRow(ROSA, "OC155-1"), studentRow(JUAN, "OC155-2")]);
}

function studentRow(id: string, nationalId: string) {
  return {
    id,
    firstName: "Alumna",
    lastName: "Sobrecupo",
    nationalIdType: "DNI",
    nationalId,
    email: `${nationalId.toLowerCase()}@gmail.com`,
    phone: "+51900000000",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  };
}

async function counters(tx: Db, id: string): Promise<{ taken: number; over: number }> {
  const [row] = await tx
    .select({ taken: classGroups.seatsTaken, over: classGroups.seatsOver })
    .from(classGroups)
    .where(eq(classGroups.id, id));
  return row!;
}

async function claim(tx: Db, classGroupId = GROUP_A): Promise<string> {
  const claimed = await new DrizzleSeatHoldRepository(tx).claim({ classGroupId, origin: "web", holdMinutes: 15 });
  if (claimed.kind !== "held") throw new Error(`hold not taken: ${claimed.kind}`);
  return claimed.hold.id;
}

/** The clock ran out on the database; with `sweep`, the sweep also passed and gave the seat back. */
async function runOut(tx: Db, holdId: string, sweep: boolean): Promise<void> {
  await tx.update(seatHolds).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(seatHolds.id, holdId));
  if (sweep) await new DrizzleSeatHoldRepository(tx).expireDue(100);
}

async function submitParams(tx: Db, holdId: string): Promise<SubmitPublicEnrollmentParams> {
  const [upload] = await tx
    .insert(receiptUploads)
    .values({ seatHoldId: holdId, objectKey: `receipts/over-capacity-integration/${holdId}`, status: "uploaded" })
    .returning({ id: receiptUploads.id });
  const student = Student.create({
    firstName: "Rosa",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "70155001",
    email: "over.capacity.integration@gmail.com",
    phone: "+51987654321",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    region: "Lima",
    city: "Lima",
  });
  const enrollment = Enrollment.createFromPublicCheckout({
    studentId: student.id,
    classGroupId: GROUP_A,
    planPriceId: PRICE,
    origin: "web",
  });
  const payment = Payment.createFromPublicCheckout({
    enrollmentId: enrollment.id,
    idempotencyKey: `over-capacity-integration-${holdId}`,
    method: "yape",
    methodDetail: null,
    amountCents: 9900,
    operationNumber: `OC155${holdId.slice(0, 6)}`,
  });
  return {
    seatHoldId: holdId,
    student,
    guardian: null,
    consent: null,
    enrollment,
    payment,
    receiptUploadId: upload!.id,
    notifications: [],
  };
}

async function manual(
  tx: Db,
  studentId: string,
  classGroupId: string,
  allowOverCapacity: boolean,
  placement: SeatPlacement = "class_group",
): Promise<{ enrollmentId: string; paymentId: string; overCapacity: boolean; classGroupId: string }> {
  const { receipt } = await seedManualReceipt(tx, STAFF);
  const enrollment = Enrollment.createManual({ studentId, classGroupId, planPriceId: PRICE });
  const payment = Payment.createManual({
    enrollmentId: enrollment.id,
    method: "yape",
    methodDetail: null,
    amountCents: 9900,
    operationNumber: `OC155-${crypto.randomUUID().slice(0, 8)}`,
  });
  const created = await new DrizzleEnrollmentRepository(tx).createWithPayment({
    enrollment,
    payment,
    notifications: [],
    receipt,
    allowOverCapacity,
    placement,
  });
  return {
    enrollmentId: created.enrollment.id,
    paymentId: created.payment.id,
    overCapacity: created.enrollment.overCapacity,
    classGroupId: created.enrollment.classGroupId,
  };
}

function moveUseCase(tx: Db): MoveEnrollmentUseCase {
  return new MoveEnrollmentUseCase(
    new DrizzleEnrollmentMoveRepository(tx),
    new DrizzlePlanPriceLookup(tx),
    new DrizzleAuditLogRepository(tx),
  );
}

describe("an expired checkout hold that comes back paid (OOC-155, case 1)", () => {
  it("goes above capacity when every class group of the schedule filled meanwhile", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const late = await claim(tx);
      await runOut(tx, late, true);
      await claim(tx); // somebody else takes the seat that came back
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });

      const result = await new DrizzlePublicEnrollmentRepository(tx).submit(await submitParams(tx, late));

      expect(result.enrollment.classGroupId).toBe(GROUP_A);
      expect(result.enrollment.overCapacity).toBe(true);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 1 });
      const [hold] = await tx.select({ status: seatHolds.status }).from(seatHolds).where(eq(seatHolds.id, late));
      expect(hold!.status).toBe("consumed");
    });
  });

  it("takes a regular seat in a sibling when the schedule still has one", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      const late = await claim(tx);
      await runOut(tx, late, true);
      await claim(tx); // fills A again

      const result = await new DrizzlePublicEnrollmentRepository(tx).submit(await submitParams(tx, late));

      expect(result.enrollment.classGroupId).toBe(GROUP_B);
      expect(result.enrollment.overCapacity).toBe(false);
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
    });
  });

  it("keeps the seat it still holds when the sweep has not passed yet", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const late = await claim(tx);
      await runOut(tx, late, false);

      const result = await new DrizzlePublicEnrollmentRepository(tx).submit(await submitParams(tx, late));

      expect(result.enrollment.overCapacity).toBe(false);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
    });
  });

  it("refuses a hold the checkout itself released", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const let_go = await claim(tx);
      await new DrizzleSeatHoldRepository(tx).release(let_go);

      await expect(
        new DrizzlePublicEnrollmentRepository(tx).submit(await submitParams(tx, let_go)),
      ).rejects.toBeInstanceOf(SeatHoldExpiredError);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 0, over: 0 });
    });
  });
});

describe("a class group above capacity", () => {
  it("never shows room again when a regular seat comes back, to the claim or the public catalog", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const regular = await manual(tx, ROSA, GROUP_A, false);
      await manual(tx, JUAN, GROUP_A, true);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 1 });

      // The regular seat is rejected in Pagos and goes back.
      await new DrizzlePaymentSettlementRepository(tx).settle({
        paymentId: regular.paymentId,
        origin: { kind: "enrollment", enrollmentId: regular.enrollmentId, classGroupId: GROUP_A, seatStatus: "reserved" },
        to: "rejected",
        decision: { by: STAFF, at: new Date(), rejectionReason: "other" },
        notifications: [],
        audit: { actorId: STAFF, action: "payment.rejected", targetId: regular.paymentId, at: new Date() },
        portalAccess: null,
      });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 0, over: 1 });

      const claimed = await new DrizzleSeatHoldRepository(tx).claim({ classGroupId: GROUP_A, origin: "web", holdMinutes: 15 });
      expect(claimed.kind).toBe("full");
      const catalog = await new GetPublicCatalogQuery(tx).run();
      const listed = catalog.classGroups.find((group) => group.id === GROUP_A);
      expect(listed && listed.capacity - listed.seatsTaken).toBe(0);
    });
  });

  it("gives an over-capacity seat back to seats_over when its payment is rejected", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await manual(tx, ROSA, GROUP_A, false);
      const over = await manual(tx, JUAN, GROUP_A, true);

      await new DrizzlePaymentSettlementRepository(tx).settle({
        paymentId: over.paymentId,
        origin: { kind: "enrollment", enrollmentId: over.enrollmentId, classGroupId: GROUP_A, seatStatus: "reserved" },
        to: "rejected",
        decision: { by: STAFF, at: new Date(), rejectionReason: "other" },
        notifications: [],
        audit: { actorId: STAFF, action: "payment.rejected", targetId: over.paymentId, at: new Date() },
        portalAccess: null,
      });

      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
    });
  });
});

describe("the manual enrollment into a full class group (OOC-155, case 2)", () => {
  it("is refused without the confirmation and goes above capacity with it", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await manual(tx, ROSA, GROUP_A, false);

      await expect(manual(tx, JUAN, GROUP_A, false)).rejects.toBeInstanceOf(ClassGroupFullError);
      const over = await manual(tx, JUAN, GROUP_A, true);

      expect(over.overCapacity).toBe(true);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 1 });
    });
  });

  it("takes a regular seat even with the confirmation while there is room", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const created = await manual(tx, ROSA, GROUP_A, true);
      expect(created.overCapacity).toBe(false);
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
    });
  });
});

describe("moving an enrollment (OOC-84)", () => {
  it("moves the seat between counters and records the move", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);

      const moved = await moveUseCase(tx).run({
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: GROUP_B,
        planId: null,
        allowOverCapacity: false,
        reason: "  Cambio de horario pedido por WhatsApp  ",
      });

      expect(moved).toEqual({
        enrollmentId,
        classGroupId: GROUP_B,
        classGroupModuleId: GROUP_B,
        overCapacity: false,
        planChanged: false,
      });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 0, over: 0 });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });
      const [trail] = await tx
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.action, "enrollment.moved"), eq(auditLog.targetId, enrollmentId)));
      expect(trail!.metadata).toMatchObject({
        studentId: ROSA,
        fromClassGroupId: GROUP_A,
        toClassGroupId: GROUP_B,
        planChanged: false,
        reason: "Cambio de horario pedido por WhatsApp",
      });
    });
  });

  it("asks before a full class group, and gives an over-capacity seat back to seats_over", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      await manual(tx, JUAN, GROUP_B, false); // B is full
      const input = { actorId: STAFF, enrollmentId, classGroupModuleId: GROUP_B, planId: null, reason: "Mismo docente" };

      await expect(moveUseCase(tx).run({ ...input, allowOverCapacity: false })).rejects.toBeInstanceOf(ClassGroupFullError);
      const moved = await moveUseCase(tx).run({ ...input, allowOverCapacity: true });
      expect(moved.overCapacity).toBe(true);
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 1 });

      // Back to A: the seat leaves B's seats_over, not its seats_taken.
      await moveUseCase(tx).run({ ...input, classGroupModuleId: GROUP_A, allowOverCapacity: false });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
    });
  });

  it("to another course needs a plan of that course, and takes its price in force", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      const input = {
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: GROUP_OTHER_COURSE,
        allowOverCapacity: false,
        reason: "Cambio de curso",
      };

      await expect(moveUseCase(tx).run({ ...input, planId: null })).rejects.toMatchObject({
        reason: "enrollment.move_plan_required",
      });
      await expect(moveUseCase(tx).run({ ...input, planId: PLAN })).rejects.toMatchObject({
        reason: "enrollment.move_plan_not_of_course",
      });

      const moved = await moveUseCase(tx).run({ ...input, planId: OTHER_PLAN });
      expect(moved.planChanged).toBe(true);
      const [row] = await tx
        .select({ planPriceId: enrollments.planPriceId, classGroupId: enrollments.classGroupId })
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId));
      expect(row).toEqual({ planPriceId: OTHER_PRICE, classGroupId: GROUP_OTHER_COURSE });
    });
  });

  it("refuses a released seat and a target that is not running", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      await tx.update(classGroups).set({ status: "finished" }).where(eq(classGroups.id, GROUP_B));
      const input = { actorId: STAFF, enrollmentId, planId: null, allowOverCapacity: true, reason: "x" };

      await expect(moveUseCase(tx).run({ ...input, classGroupModuleId: GROUP_B })).rejects.toMatchObject({
        reason: "enrollment.move_target_unavailable",
      });

      await tx.update(enrollments).set({ seatStatus: "released" }).where(eq(enrollments.id, enrollmentId));
      await expect(moveUseCase(tx).run({ ...input, classGroupModuleId: GROUP_OTHER_COURSE, planId: OTHER_PLAN })).rejects.toBeInstanceOf(
        EnrollmentMoveRefusedError,
      );
    });
  });

  it("to another module run of the same class group: the run changes, the seat stays (OOC-156)", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      const [second] = await tx
        .insert(classGroupModules)
        .values({ classGroupId: GROUP_A, module: 2, slots: [{ weekday: "thu", startTime: "18:00", endTime: "19:30" }] })
        .returning({ id: classGroupModules.id });

      const moved = await moveUseCase(tx).run({
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: second!.id,
        planId: null,
        allowOverCapacity: false,
        reason: "Pasa al módulo 2",
      });

      expect(moved).toMatchObject({ classGroupId: GROUP_A, classGroupModuleId: second!.id, overCapacity: false });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
      const [row] = await tx
        .select({ classGroupId: enrollments.classGroupId, classGroupModuleId: enrollments.classGroupModuleId })
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId));
      expect(row).toEqual({ classGroupId: GROUP_A, classGroupModuleId: second!.id });

      // Back to the first run, the one 0058 made under the class group's id.
      await moveUseCase(tx).run({
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: GROUP_A,
        planId: null,
        allowOverCapacity: false,
        reason: "Vuelve",
      });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
      await expect(
        moveUseCase(tx).run({
          actorId: STAFF,
          enrollmentId,
          classGroupModuleId: GROUP_A,
          planId: null,
          allowOverCapacity: false,
          reason: "Otra vez",
        }),
      ).rejects.toMatchObject({ reason: "enrollment.move_same_class_group" });
    });
  });

  it("puts a manual enrollment in the class group's first run", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await tx.update(classGroupModules).set({ module: 2 }).where(eq(classGroupModules.id, GROUP_A));
      const [first] = await tx
        .insert(classGroupModules)
        .values({ classGroupId: GROUP_A, module: 1, slots: SLOTS })
        .returning({ id: classGroupModules.id });

      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      const [row] = await tx
        .select({ classGroupModuleId: enrollments.classGroupModuleId })
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId));
      expect(row?.classGroupModuleId).toBe(first!.id);
    });
  });
});

/** GROUP_D: same course and dates as A/B, on Saturdays — one seat, one run under its own id. */
async function seedGroupD(tx: Db): Promise<void> {
  const [a] = await tx
    .select({ startsOn: classGroups.startsOn, endsOn: classGroups.endsOn })
    .from(classGroups)
    .where(eq(classGroups.id, GROUP_A));
  await tx.insert(classGroups).values({
    id: GROUP_D,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    slots: [{ weekday: "sat", startTime: "09:00", endTime: "10:30" }],
    code: "A-OC-4",
    startsOn: a!.startsOn,
    endsOn: a!.endsOn,
    capacity: 1,
    seatsTaken: 0,
    status: "enrolling",
  });
  await seedModuleRuns(tx);
  await tx.insert(students).values(studentRow(PEDRO, "OC155-3"));
}

describe("staff picking the schedule instead of the class group (OOC-145)", () => {
  it("a manual enrollment fills the schedule's class groups in code order, above capacity only when all are full", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      await seedGroupD(tx);

      expect((await manual(tx, ROSA, GROUP_A, false, "schedule")).classGroupId).toBe(GROUP_A);
      // Named A again, A is full: the seat goes to its sibling.
      const second = await manual(tx, JUAN, GROUP_A, false, "schedule");
      expect(second).toMatchObject({ classGroupId: GROUP_B, overCapacity: false });

      await expect(manual(tx, PEDRO, GROUP_B, false, "schedule")).rejects.toBeInstanceOf(ClassGroupFullError);
      // Above capacity goes to the first in fill order, whichever was named.
      const over = await manual(tx, PEDRO, GROUP_B, true, "schedule");
      expect(over).toMatchObject({ classGroupId: GROUP_A, overCapacity: true });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 1 });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });

      const [row] = await tx
        .select({ classGroupId: enrollments.classGroupId, classGroupModuleId: enrollments.classGroupModuleId })
        .from(enrollments)
        .where(eq(enrollments.id, second.enrollmentId));
      // The seat, the class group and the entry run agree.
      expect(row).toEqual({ classGroupId: GROUP_B, classGroupModuleId: GROUP_B });
    });
  });

  it("a manual enrollment naming the class group still takes exactly that one", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      await manual(tx, ROSA, GROUP_A, false);
      await expect(manual(tx, JUAN, GROUP_A, false)).rejects.toBeInstanceOf(ClassGroupFullError);
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 0, over: 0 });
    });
  });

  it("a move to the schedule lands in the sibling with room, and asks only when every one is full", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      await seedGroupD(tx);
      await manual(tx, JUAN, GROUP_A, false); // A is full
      const { enrollmentId } = await manual(tx, ROSA, GROUP_D, false);
      const input = { actorId: STAFF, enrollmentId, planId: null, reason: "Pasa al martes", placement: "schedule" as const };

      const moved = await moveUseCase(tx).run({ ...input, classGroupModuleId: GROUP_A, allowOverCapacity: false });
      expect(moved).toMatchObject({ classGroupId: GROUP_B, classGroupModuleId: GROUP_B, overCapacity: false });
      expect(await counters(tx, GROUP_D)).toEqual({ taken: 0, over: 0 });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });
      const [trail] = await tx
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.action, "enrollment.moved"), eq(auditLog.targetId, enrollmentId)));
      expect(trail!.metadata).toMatchObject({ fromClassGroupId: GROUP_D, toClassGroupId: GROUP_B });

      // PEDRO from D onto the same hour: A and B are full now.
      const pedro = await manual(tx, PEDRO, GROUP_D, false);
      const pedroInput = { ...input, enrollmentId: pedro.enrollmentId, classGroupModuleId: GROUP_B };
      await expect(moveUseCase(tx).run({ ...pedroInput, allowOverCapacity: false })).rejects.toBeInstanceOf(ClassGroupFullError);
      expect(await counters(tx, GROUP_D)).toEqual({ taken: 1, over: 0 });
      const over = await moveUseCase(tx).run({ ...pedroInput, allowOverCapacity: true });
      expect(over).toMatchObject({ classGroupId: GROUP_A, overCapacity: true });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 1 });
      expect(await counters(tx, GROUP_D)).toEqual({ taken: 0, over: 0 });
    });
  });

  it("a move to the next module's schedule keeps the seat in its own class group when it has that run", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      const thursday = [{ weekday: "thu", startTime: "18:00", endTime: "19:30" }];
      const [ownSecond] = await tx
        .insert(classGroupModules)
        .values({ classGroupId: GROUP_A, module: 2, slots: thursday })
        .returning({ id: classGroupModules.id });
      const [siblingSecond] = await tx
        .insert(classGroupModules)
        .values({ classGroupId: GROUP_B, module: 2, slots: thursday })
        .returning({ id: classGroupModules.id });

      // B has room and comes first by id, but A is where the seat already is.
      const moved = await moveUseCase(tx).run({
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: siblingSecond!.id,
        planId: null,
        allowOverCapacity: false,
        reason: "Pasa al módulo 2",
        placement: "schedule",
      });
      expect(moved).toMatchObject({ classGroupId: GROUP_A, classGroupModuleId: ownSecond!.id, overCapacity: false });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 1, over: 0 });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 0, over: 0 });
    });
  });

  it("a move naming the run still takes exactly that run", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx, { siblings: true });
      const { enrollmentId } = await manual(tx, ROSA, GROUP_A, false);
      const thursday = [{ weekday: "thu", startTime: "18:00", endTime: "19:30" }];
      await tx.insert(classGroupModules).values({ classGroupId: GROUP_A, module: 2, slots: thursday });
      const [siblingSecond] = await tx
        .insert(classGroupModules)
        .values({ classGroupId: GROUP_B, module: 2, slots: thursday })
        .returning({ id: classGroupModules.id });

      const moved = await moveUseCase(tx).run({
        actorId: STAFF,
        enrollmentId,
        classGroupModuleId: siblingSecond!.id,
        planId: null,
        allowOverCapacity: false,
        reason: "Al grupo de B",
      });
      expect(moved).toMatchObject({ classGroupId: GROUP_B, classGroupModuleId: siblingSecond!.id });
      expect(await counters(tx, GROUP_A)).toEqual({ taken: 0, over: 0 });
      expect(await counters(tx, GROUP_B)).toEqual({ taken: 1, over: 0 });
    });
  });
});
