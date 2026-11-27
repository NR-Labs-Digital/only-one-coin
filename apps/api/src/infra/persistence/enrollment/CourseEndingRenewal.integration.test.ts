import * as schema from "@ooc/db";
import { academicPeriods, classGroupModules, classGroups, courses, enrollments, outbox, planPrices, plans, students } from "@ooc/db";
import { SendCourseEndingRenewalUseCase } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleCourseEndingRenewalRepository } from "./DrizzleCourseEndingRenewalRepository.js";

/**
 * The renewal tick (OOC-53) against the real SQL: the class group's end read
 * as a Lima day, and only confirmed seats of live, running class groups.
 * Every test runs in a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the renewal SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-5300-7000-8000-000000000001";
const COURSE = "018f2b5c-5300-7000-8000-000000000002";
const PLAN = "018f2b5c-5300-7000-8000-000000000003";
const PRICE = "018f2b5c-5300-7000-8000-000000000004";
const ENDING = "018f2b5c-5300-7000-8000-000000000005";
const LATER = "018f2b5c-5300-7000-8000-000000000006";
const FINISHED = "018f2b5c-5300-7000-8000-000000000007";
// Tuesday 08/12/2026, 10:00 in Lima: due for the class groups ending on 15/12.
const NOW = new Date("2026-12-08T15:00:00Z");

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
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

let documentSeq = 0;
async function enrolled(tx: Tx, classGroupId: string, seatStatus: "confirmed" | "reserved" | "frozen" | "released"): Promise<string> {
  documentSeq += 1;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Renovación",
      lastName: `Integración ${documentSeq}`,
      nationalIdType: "DNI",
      nationalId: `RENEW${documentSeq.toString().padStart(4, "0")}`,
      email: `renewal.integration${documentSeq}@gmail.com`,
      phone: "999999999",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      country: "PE",
      region: "Lima",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId, classGroupModuleId: classGroupId, planPriceId: PRICE, seatStatus })
    .returning({ id: enrollments.id });
  return enrollment!.id;
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (renewal integration)",
    startsOn: new Date("2026-09-01T05:00:00.000Z"),
    endsOn: new Date("2026-12-31T05:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés (renewal integration)", language: "Inglés", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 30000 });
  const group = (id: string, code: string, endsOn: string, status: "in_progress" | "finished") => ({
    id,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code,
    startsOn: new Date("2026-09-01T05:00:00.000Z"),
    endsOn: new Date(endsOn),
    capacity: 30,
    seatsTaken: 0,
    status,
  });
  await tx.insert(classGroups).values([
    // 15/12 in Lima: midnight Lima is 05:00 UTC.
    group(ENDING, "A-05301", "2026-12-15T05:00:00.000Z", "in_progress"),
    // 00:30 of the 16th in Lima: a day later, not due.
    group(LATER, "A-05302", "2026-12-16T05:30:00.000Z", "in_progress"),
    group(FINISHED, "A-05303", "2026-12-15T05:00:00.000Z", "finished"),
  ]);
  await tx.insert(classGroupModules).values([
    { id: ENDING, classGroupId: ENDING, module: 1 },
    { id: LATER, classGroupId: LATER, module: 1 },
    { id: FINISHED, classGroupId: FINISHED, module: 1 },
  ]);
}

describe("DrizzleCourseEndingRenewalRepository", () => {
  it("writes the confirmed seats of the class groups ending in seven days, once", async () => {
    await rolledBack(async (tx) => {
      await seed(tx);
      const confirmed = await enrolled(tx, ENDING, "confirmed");
      await enrolled(tx, ENDING, "reserved");
      await enrolled(tx, ENDING, "frozen");
      await enrolled(tx, ENDING, "released");
      await enrolled(tx, LATER, "confirmed");
      await enrolled(tx, FINISHED, "confirmed");
      const send = new SendCourseEndingRenewalUseCase(new DrizzleCourseEndingRenewalRepository(tx as unknown as Db));

      expect(await send.run({ locale: "es-PE", now: NOW })).toEqual({ queued: 1 });
      expect(await send.run({ locale: "es-PE", now: NOW })).toEqual({ queued: 0 });
      const rows = await tx
        .select({ key: outbox.dedupeKey, vars: outbox.vars })
        .from(outbox)
        .where(eq(outbox.templateKey, "course_ending_renewal"));
      expect(rows).toEqual([
        {
          key: `course_ending_renewal:${confirmed}:2026-12-15:student`,
          vars: expect.objectContaining({ courseName: "Inglés (renewal integration)", endsOn: "2026-12-15T05:00:00.000Z" }),
        },
      ]);
    });
  });

  it("leaves a retired class group out", async () => {
    await rolledBack(async (tx) => {
      await seed(tx);
      await enrolled(tx, ENDING, "confirmed");
      await tx.update(classGroups).set({ deletedAt: new Date() }).where(eq(classGroups.id, ENDING));
      const send = new SendCourseEndingRenewalUseCase(new DrizzleCourseEndingRenewalRepository(tx as unknown as Db));
      expect(await send.run({ locale: "es-PE", now: NOW })).toEqual({ queued: 0 });
    });
  });
});
