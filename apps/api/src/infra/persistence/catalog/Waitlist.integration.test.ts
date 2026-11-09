import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, planPrices, plans, students, waitlistEntries } from "@ooc/db";
import { Enrollment, Payment, WaitlistAlreadyJoinedError, WaitlistEntry, WaitlistEntryClosedError } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEnrollmentRepository } from "@/infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzleWaitlistRepository } from "./DrizzleWaitlistRepository.js";
import { ListWaitlistQuery } from "./ListWaitlistQuery.js";
import { seedManualReceipt } from "@/tests/fixtures/manualReceipt.js";

/**
 * The manual waitlist (OOC-35), checked where it is written: the same student
 * queues once per class group while still waiting (partial unique index), a
 * student who left can queue again, the list is FIFO and shows only who is
 * still waiting — and the manual enrollment closes the student's place in the
 * same transaction that takes the seat.
 *
 * Every test runs inside a transaction that never commits: the repositories
 * open their own transactions (savepoints here), and students / payments /
 * plan_prices rows cannot be deleted afterwards (migrations 0011, 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the waitlist against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-5d00-7000-8000-000000000001";
const COURSE = "018f2b5c-5d00-7000-8000-000000000002";
const PLAN = "018f2b5c-5d00-7000-8000-000000000003";
const PRICE = "018f2b5c-5d00-7000-8000-000000000004";
const FULL = "018f2b5c-5d00-7000-8000-000000000011";
const ENROLLED = "018f2b5c-5d00-7000-8000-000000000021";
const WAITING = "018f2b5c-5d00-7000-8000-000000000022";
const LATER = "018f2b5c-5d00-7000-8000-000000000023";
const UNKNOWN = "018f2b5c-5d00-7000-8000-0000000000ff";

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

function studentRow(id: string, firstName: string, lastName: string, nationalId: string) {
  return {
    id,
    firstName,
    lastName,
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
    name: "Ciclo (waitlist integration)",
    startsOn: new Date(now - 30 * DAY),
    endsOn: new Date(now + 60 * DAY),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (waitlist integration)", language: "Lengua de prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete (waitlist integration)" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) });
  await tx.insert(classGroups).values({
    id: FULL,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    slots: [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }],
    code: "WAITLIST-01",
    teacherName: "Docente de prueba",
    startsOn: new Date(now + 7 * DAY),
    endsOn: new Date(now + 50 * DAY),
    capacity: 1,
    seatsTaken: 1,
    status: "enrolling",
  });
  await tx
    .insert(students)
    .values([
      studentRow(ENROLLED, "Alumna", "Matriculada", "WAITLIST-INTEGRATION-1"),
      studentRow(WAITING, "Alumno", "En Espera", "WAITLIST-INTEGRATION-2"),
      studentRow(LATER, "Alumna", "Tardía", "WAITLIST-INTEGRATION-3"),
    ]);
  await tx.insert(enrollments).values({ studentId: ENROLLED, classGroupId: FULL, planPriceId: PRICE, seatStatus: "confirmed" });
}

// ~140 ms per round trip against the managed Postgres.
describe("waitlist", { timeout: 30_000 }, () => {
  it("tells a missing student, one already in the class group and one free to queue apart", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const waitlist = new DrizzleWaitlistRepository(tx);
      expect(await waitlist.studentStanding(WAITING, FULL)).toBe("free");
      expect(await waitlist.studentStanding(ENROLLED, FULL)).toBe("enrolled");
      expect(await waitlist.studentStanding(UNKNOWN, FULL)).toBe("missing");

      // A seat given back no longer counts as being in.
      await tx.update(enrollments).set({ seatStatus: "released" }).where(eq(enrollments.studentId, ENROLLED));
      expect(await waitlist.studentStanding(ENROLLED, FULL)).toBe("free");
    });
  });

  it("refuses a second active place, and lets a student who left queue again", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const waitlist = new DrizzleWaitlistRepository(tx);

      const first = await waitlist.join(WaitlistEntry.join({ classGroupId: FULL, studentId: WAITING }));
      expect(first).toMatchObject({ classGroupId: FULL, studentId: WAITING, leftAt: null, leftReason: null });
      expect(first.createdAt).toBeInstanceOf(Date);

      await expect(
        waitlist.join(WaitlistEntry.join({ classGroupId: FULL, studentId: WAITING })),
      ).rejects.toBeInstanceOf(WaitlistAlreadyJoinedError);

      const found = (await waitlist.findById(first.id))!;
      found.leave("withdrawn");
      await waitlist.leave(found);
      await expect(waitlist.leave(found)).rejects.toBeInstanceOf(WaitlistEntryClosedError);

      const reread = (await waitlist.findById(first.id))!;
      expect(reread.leftReason).toBe("withdrawn");
      expect(reread.leftAt).toBeInstanceOf(Date);

      const second = await waitlist.join(WaitlistEntry.join({ classGroupId: FULL, studentId: WAITING }));
      expect(second.id).not.toBe(first.id);
      expect(await waitlist.findById(UNKNOWN)).toBeNull();
    });
  });

  it("lists only who is still waiting, oldest first", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const now = Date.now();
      await tx.insert(waitlistEntries).values([
        { studentId: LATER, classGroupId: FULL, createdAt: new Date(now - 1 * DAY) },
        { studentId: WAITING, classGroupId: FULL, createdAt: new Date(now - 2 * DAY) },
        {
          studentId: ENROLLED,
          classGroupId: FULL,
          createdAt: new Date(now - 3 * DAY),
          leftAt: new Date(now - DAY),
          leftReason: "enrolled",
        },
      ]);

      const list = await new ListWaitlistQuery(tx).run(FULL);
      expect(list.map((row) => row.studentId)).toEqual([WAITING, LATER]);
      expect(list[0]).toMatchObject({
        studentId: WAITING,
        studentName: "Alumno En Espera",
        nationalIdType: "DNI",
        nationalId: "WAITLIST-INTEGRATION-2",
        joinedAt: new Date(now - 2 * DAY).toISOString(),
      });
      expect(list[0]!.id).toEqual(expect.any(String));
    });
  });

  it("leaves out a student who got a seat some other way, until that seat is given back", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const now = Date.now();
      // ENROLLED queued, then enrolled through the public checkout — which
      // does not close waitlist entries — so the entry is still open.
      await tx.insert(waitlistEntries).values([
        { studentId: ENROLLED, classGroupId: FULL, createdAt: new Date(now - 3 * DAY) },
        { studentId: WAITING, classGroupId: FULL, createdAt: new Date(now - 2 * DAY) },
      ]);

      const query = new ListWaitlistQuery(tx);
      expect((await query.run(FULL)).map((row) => row.studentId)).toEqual([WAITING]);

      // A seat given back no longer counts as being in.
      await tx.update(enrollments).set({ seatStatus: "released" }).where(eq(enrollments.studentId, ENROLLED));
      expect((await query.run(FULL)).map((row) => row.studentId)).toEqual([ENROLLED, WAITING]);
    });
  });

  it("the manual enrollment closes the student's place in the queue", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const entry = await new DrizzleWaitlistRepository(tx).join(
        WaitlistEntry.join({ classGroupId: FULL, studentId: WAITING }),
      );

      // A seat frees up; staff enrolls the student from the queue.
      await tx.update(classGroups).set({ seatsTaken: 0 }).where(eq(classGroups.id, FULL));
      const enrollment = Enrollment.createManual({ studentId: WAITING, classGroupId: FULL, planPriceId: PRICE });
      const payment = Payment.createManual({
        enrollmentId: enrollment.id,
        method: "yape",
        methodDetail: null,
        amountCents: 9900,
        operationNumber: "WAITLISTINTEG0001",
      });
      const { receipt } = await seedManualReceipt(tx, "usr_waitlist_integ");
      await new DrizzleEnrollmentRepository(tx).createWithPayment({ enrollment, payment, notifications: [], receipt });

      const [row] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, entry.id));
      expect(row?.leftReason).toBe("enrolled");
      expect(row?.leftAt).toBeInstanceOf(Date);
      expect(await new ListWaitlistQuery(tx).run(FULL)).toEqual([]);
    });
  });
});
