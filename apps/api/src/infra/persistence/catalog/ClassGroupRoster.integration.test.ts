import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ClassGroupRosterQuery } from "./ClassGroupRosterQuery.js";

/**
 * The class group roster, read against a real, migrated Postgres: confirmed
 * seats only, in surname order, each with its most recent payment — and a
 * class group that does not exist answers null, not an empty list.
 *
 * Every test runs inside a transaction that never commits: students,
 * payments and plan_prices rows cannot be deleted afterwards (migrations
 * 0011, 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the roster against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-6e00-7000-8000-000000000001";
const COURSE = "018f2b5c-6e00-7000-8000-000000000002";
const PLAN = "018f2b5c-6e00-7000-8000-000000000003";
const PRICE = "018f2b5c-6e00-7000-8000-000000000004";
const GROUP = "018f2b5c-6e00-7000-8000-000000000011";
const OTHER_GROUP = "018f2b5c-6e00-7000-8000-000000000012";
const ZAPATA = "018f2b5c-6e00-7000-8000-000000000021";
const ALVAREZ = "018f2b5c-6e00-7000-8000-000000000022";
const RESERVED = "018f2b5c-6e00-7000-8000-000000000023";
const RELEASED = "018f2b5c-6e00-7000-8000-000000000024";
const RETIRED = "018f2b5c-6e00-7000-8000-000000000025";
const ELSEWHERE = "018f2b5c-6e00-7000-8000-000000000026";
const EMPTY = "018f2b5c-6e00-7000-8000-000000000013";
const UNKNOWN = "018f2b5c-6e00-7000-8000-0000000000ff";

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

function groupRow(id: string, code: string) {
  const now = Date.now();
  return {
    id,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    slots: [{ weekday: "mon" as const, startTime: "19:00", endTime: "20:30" }],
    code,
    teacherName: "",
    startsOn: new Date(now + 7 * DAY),
    endsOn: new Date(now + 50 * DAY),
    capacity: 10,
    seatsTaken: 5,
    status: "enrolling",
  };
}

let sequence = 0;
async function payment(tx: Db, enrollmentId: string, status: "pending" | "approved", createdAt: Date): Promise<void> {
  sequence += 1;
  await tx.insert(payments).values({
    enrollmentId,
    idempotencyKey: `roster-integration-${Date.now()}-${sequence}`,
    status,
    method: "yape",
    amountCents: 9900,
    decidedAt: status === "approved" ? createdAt : null,
    createdAt,
  });
}

async function seed(tx: Db): Promise<Record<string, string>> {
  const now = Date.now();
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (roster integration)",
    startsOn: new Date(now - 30 * DAY),
    endsOn: new Date(now + 60 * DAY),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (roster integration)", language: "Lengua de prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Mensual (roster integration)" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) });
  await tx.insert(classGroups).values([groupRow(GROUP, "ROSTER-01"), groupRow(OTHER_GROUP, "ROSTER-02")]);
  await tx
    .insert(students)
    .values([
      studentRow(ZAPATA, "Ana", "Zapata", "ROSTER-INTEGRATION-1"),
      studentRow(ALVAREZ, "Luis", "Alvarez", "ROSTER-INTEGRATION-2"),
      studentRow(RESERVED, "Rosa", "Reservada", "ROSTER-INTEGRATION-3"),
      studentRow(RELEASED, "Raúl", "Devuelto", "ROSTER-INTEGRATION-4"),
      studentRow(RETIRED, "Rita", "Retirada", "ROSTER-INTEGRATION-5"),
      studentRow(ELSEWHERE, "Elsa", "Otra", "ROSTER-INTEGRATION-6"),
    ]);

  const enroll = async (studentId: string, classGroupId: string, seatStatus: string, deletedAt: Date | null = null) => {
    const [row] = await tx
      .insert(enrollments)
      .values({ studentId, classGroupId, planPriceId: PRICE, seatStatus, deletedAt })
      .returning({ id: enrollments.id });
    return row!.id;
  };

  const ids = {
    zapata: await enroll(ZAPATA, GROUP, "confirmed"),
    alvarez: await enroll(ALVAREZ, GROUP, "confirmed"),
  };
  await enroll(RESERVED, GROUP, "reserved");
  await enroll(RELEASED, GROUP, "released");
  await enroll(RETIRED, GROUP, "confirmed", new Date());
  await enroll(ELSEWHERE, OTHER_GROUP, "confirmed");

  // Zapata is monthly: the first module approved, the next one still open.
  await payment(tx, ids.zapata, "approved", new Date(now - 20 * DAY));
  await payment(tx, ids.zapata, "pending", new Date(now - DAY));
  await payment(tx, ids.alvarez, "approved", new Date(now - 10 * DAY));
  return ids;
}

// ~140 ms per round trip against the managed Postgres.
describe("class group roster", { timeout: 30_000 }, () => {
  it("lists the confirmed seats of the class group in surname order, with the latest payment", async () => {
    await inRolledBackTransaction(async (tx) => {
      const ids = await seed(tx);
      const roster = await new ClassGroupRosterQuery(tx).run(GROUP);

      expect(roster).toEqual([
        {
          enrollmentId: ids.alvarez,
          studentId: ALVAREZ,
          firstName: "Luis",
          lastName: "Alvarez",
          nationalIdType: "DNI",
          nationalId: "ROSTER-INTEGRATION-2",
          email: "roster-integration-2@gmail.com",
          phone: "+51900000000",
          planName: "Mensual (roster integration)",
          paymentStatus: "approved",
        },
        expect.objectContaining({ enrollmentId: ids.zapata, studentId: ZAPATA, paymentStatus: "pending" }),
      ]);
    });
  });

  it("answers an empty list for a class group with nobody in, and null for one that does not exist", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await tx.insert(classGroups).values(groupRow(EMPTY, "ROSTER-03"));
      const query = new ClassGroupRosterQuery(tx);
      expect(await query.run(EMPTY)).toEqual([]);
      expect(await query.run(UNKNOWN)).toBeNull();
    });
  });
});
