import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  enrollments,
  grades,
  guardians,
  outbox,
  planPrices,
  plans,
  procedurePrices,
  procedureRequests,
  students,
} from "@ooc/db";
import { EnrollmentTransferConflictError, EnrollmentTransferRefusedError, TransferEnrollmentUseCase } from "@ooc/domain";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { PortalLinkBuilder } from "@/infra/identity/PortalLinkBuilder.js";
import { DrizzlePortalAccessRepository } from "@/infra/persistence/portal/DrizzlePortalAccessRepository.js";
import { DrizzleEnrollmentTransferRepository } from "./DrizzleEnrollmentTransferRepository.js";

/**
 * Handing an enrollment to another person (OOC-105), against the real SQL:
 * only `student_id` moves, the counters stay, the refusals read the database,
 * and the destination's portal opens. Every test runs in a transaction that
 * is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the transfer SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-1050-7000-8000-000000000001";
const COURSE = "018f2b5c-1050-7000-8000-000000000002";
const PLAN = "018f2b5c-1050-7000-8000-000000000003";
const PRICE = "018f2b5c-1050-7000-8000-000000000004";
const GROUP = "018f2b5c-1050-7000-8000-000000000005";
const STAFF = "usr_transfer_staff";

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

interface Seeded {
  enrollmentId: string;
  holderId: string;
  destinationId: string;
  transfer: TransferEnrollmentUseCase;
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

let documentSeq = 0;
async function student(tx: Tx, firstName: string, birthDate = "1990-01-01T00:00:00.000Z") {
  documentSeq += 1;
  const [row] = await tx
    .insert(students)
    .values({
      firstName,
      lastName: "Traspaso",
      nationalIdType: "DNI",
      nationalId: `TRANSFER${String(documentSeq).padStart(4, "0")}`,
      email: `transfer.${documentSeq}@gmail.com`,
      phone: "999999999",
      birthDate: new Date(birthDate),
      country: "PE",
      region: "Lima",
      city: "Lima",
    })
    .returning({ id: students.id });
  return row!.id;
}

/** A confirmed seat in a running class group, its holder, and a second student on file. */
async function seed(tx: Tx): Promise<Seeded> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${STAFF}, 'Coordinación', 'transfer.staff@test.local', true, 'enrollment_supervisor', now(), now())`,
  );
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (transfer integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés (transfer integration)", language: "Inglés", minAge: 12, modules: 3 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 30000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code: "A-10501",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-12-01T00:00:00.000Z"),
    capacity: 30,
    seatsTaken: 1,
    status: "in_progress",
  });
  await tx.insert(classGroupModules).values({ id: GROUP, classGroupId: GROUP, module: 1 });
  const holderId = await student(tx, "Titular");
  const destinationId = await student(tx, "Destino");
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: holderId, classGroupId: GROUP, classGroupModuleId: GROUP, planPriceId: PRICE, seatStatus: "confirmed" })
    .returning({ id: enrollments.id });
  const transfer = new TransferEnrollmentUseCase(
    new DrizzleEnrollmentTransferRepository(tx as unknown as Db),
    new DrizzlePortalAccessRepository(tx as unknown as Db),
    new PortalLinkBuilder("https://portal.example.com"),
  );
  return { enrollmentId: enrollment!.id, holderId, destinationId, transfer };
}

async function enrollmentRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(enrollments).where(eq(enrollments.id, id));
  return row!;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EnrollmentTransferRefusedError || error instanceof EnrollmentTransferConflictError) return error.reason;
    throw error;
  }
  return "none";
}

describe("enrollment transfer (OOC-105)", { timeout: 30_000 }, () => {
  it("hands the enrollment over in place: the seat stays, the trail and the portal follow", async () => {
    await rolledBack(async (tx, { enrollmentId, holderId, destinationId, transfer }) => {
      const result = await transfer.run({ actorId: STAFF, enrollmentId, toStudentId: destinationId, reason: "Cede a su hermana" });

      expect(result).toEqual({ enrollmentId, studentId: destinationId, portalAccess: "created" });
      const row = await enrollmentRow(tx, enrollmentId);
      expect(row).toMatchObject({ studentId: destinationId, classGroupId: GROUP, seatStatus: "confirmed", planPriceId: PRICE });
      const [group] = await tx.select({ taken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, GROUP));
      expect(group!.taken).toBe(1);

      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "enrollment.transferred"), eq(auditLog.targetId, enrollmentId)));
      expect(entry!.metadata).toMatchObject({ studentId: destinationId, fromStudentId: holderId, reason: "Cede a su hermana" });

      const [linked] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, destinationId));
      expect(linked!.userId).not.toBeNull();
      const credentials = await tx.select().from(outbox).where(eq(outbox.templateKey, "portal_credentials"));
      expect(credentials.length).toBeGreaterThan(0);
    });
  });

  it("refuses a course without the traspaso, a graded seat and an open procedure", async () => {
    await rolledBack(async (tx, { enrollmentId, holderId, destinationId, transfer }) => {
      const run = () => transfer.run({ actorId: STAFF, enrollmentId, toStudentId: destinationId, reason: "x" });

      await tx.update(courses).set({ allowsEnrollmentTransfer: false }).where(eq(courses.id, COURSE));
      expect(await refusal(run())).toBe("enrollment.transfer_course_disallows");
      await tx.update(courses).set({ allowsEnrollmentTransfer: true }).where(eq(courses.id, COURSE));

      const [price] = await tx
        .insert(procedurePrices)
        .values({ kind: "enrollment_certificate", amountCents: 2500 })
        .returning({ id: procedurePrices.id });
      const [request] = await tx
        .insert(procedureRequests)
        .values({ kind: "enrollment_certificate", studentId: holderId, enrollmentId, procedurePriceId: price!.id, amountCents: 2500 })
        .returning({ id: procedureRequests.id });
      expect(await refusal(run())).toBe("enrollment.transfer_procedure_open");
      await tx.update(procedureRequests).set({ status: "rejected" }).where(eq(procedureRequests.id, request!.id));

      await tx.insert(grades).values({ enrollmentId, classGroupId: GROUP, classGroupModuleId: GROUP, score: 15, recordedBy: STAFF });
      expect(await refusal(run())).toBe("enrollment.transfer_graded");

      expect((await enrollmentRow(tx, enrollmentId)).studentId).toBe(holderId);
    });
  });

  it("refuses a destination already in the course, too young, or a minor without a guardian", async () => {
    await rolledBack(async (tx, { enrollmentId, destinationId, transfer }) => {
      const run = (toStudentId: string) => transfer.run({ actorId: STAFF, enrollmentId, toStudentId, reason: "x" });

      // A reserved seat in the course is still a seat.
      await tx
        .insert(enrollments)
        .values({ studentId: destinationId, classGroupId: GROUP, classGroupModuleId: GROUP, planPriceId: PRICE, seatStatus: "reserved" });
      expect(await refusal(run(destinationId))).toBe("enrollment.transfer_student_already_enrolled");

      const child = await student(tx, "Niña", "2018-01-01T00:00:00.000Z");
      expect(await refusal(run(child))).toBe("enrollment.transfer_student_below_minimum_age");

      const teen = await student(tx, "Adolescente", "2012-01-01T00:00:00.000Z");
      expect(await refusal(run(teen))).toBe("enrollment.transfer_guardian_required");

      await tx.insert(guardians).values({
        studentId: teen,
        firstName: "Madre",
        lastName: "Traspaso",
        relationship: "mother",
        nationalIdType: "DNI",
        nationalId: "TRANSFERG001",
        email: "madre.traspaso@example.com",
        phone: "988888888",
      });
      const result = await run(teen);
      expect(result.studentId).toBe(teen);
    });
  });

  it("refuses a seat that is not confirmed", async () => {
    await rolledBack(async (tx, { enrollmentId, destinationId, transfer }) => {
      await tx.update(enrollments).set({ seatStatus: "reserved" }).where(eq(enrollments.id, enrollmentId));
      expect(await refusal(transfer.run({ actorId: STAFF, enrollmentId, toStudentId: destinationId, reason: "x" }))).toBe(
        "enrollment.transfer_seat_not_confirmed",
      );
    });
  });
});
