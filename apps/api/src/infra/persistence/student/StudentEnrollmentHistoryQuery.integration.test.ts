import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StudentEnrollmentHistoryQuery } from "./StudentEnrollmentHistoryQuery.js";
import type { Db } from "@/infra/db/client.js";

/**
 * The student file's enrollment tab (OOC-73). Unlike the ledger it must list
 * every seat the person ever opened — reserved, confirmed and released — and
 * speak for each one through its latest payment.
 *
 * Runs against a real, migrated Postgres inside a transaction that is always
 * rolled back (`pnpm db:up && pnpm db:migrate`, then `pnpm test:api:db`).
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises StudentEnrollmentHistoryQuery against a real, migrated Postgres.",
  );
}

const PERIOD = "018f2b5c-3000-7000-8000-000000000001";
const COURSE = "018f2b5c-3000-7000-8000-000000000002";
const PLAN = "018f2b5c-3000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-3000-7000-8000-000000000004";
const GROUP = "018f2b5c-3000-7000-8000-000000000005";
const STUDENT = "018f2b5c-3000-7000-8000-000000000006";
const OTHER_STUDENT = "018f2b5c-3000-7000-8000-000000000007";

const CONFIRMED = "018f2b5c-3000-7000-8000-000000000010";
const RESERVED = "018f2b5c-3000-7000-8000-000000000011";
const RELEASED = "018f2b5c-3000-7000-8000-000000000012";
const RETIRED = "018f2b5c-3000-7000-8000-000000000013";
const NO_PAYMENT = "018f2b5c-3000-7000-8000-000000000014";
const SOMEONE_ELSES = "018f2b5c-3000-7000-8000-000000000015";

let pool: pg.Pool;
let db: Db;
let query: StudentEnrollmentHistoryQuery;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  query = new StudentEnrollmentHistoryQuery(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("begin");
  await seed();
});

afterEach(async () => {
  await pool.query("rollback");
});

async function seed(): Promise<void> {
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (history integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await db.insert(courses).values({ id: COURSE, name: "Curso (history)", language: "Lengua (history)", minAge: 12 });
  await db.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await db.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 12000 });
  await db.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    code: "HIST-01",
    teacherName: "Docente de prueba",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 50,
  });

  await db.insert(students).values(
    [STUDENT, OTHER_STUDENT].map((id, i) => ({
      id,
      firstName: `Alumno${i}`,
      lastName: "History",
      nationalIdType: "DNI",
      nationalId: `HISTORY${i}`,
      email: `history.${i}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })),
  );

  const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 12, minute));
  await db.insert(enrollments).values([
    { id: CONFIRMED, studentId: STUDENT, seatStatus: "confirmed", createdAt: at(1) },
    { id: RESERVED, studentId: STUDENT, seatStatus: "reserved", createdAt: at(2) },
    { id: RELEASED, studentId: STUDENT, seatStatus: "released", createdAt: at(3) },
    { id: RETIRED, studentId: STUDENT, seatStatus: "confirmed", createdAt: at(4), deletedAt: at(5) },
    { id: NO_PAYMENT, studentId: STUDENT, seatStatus: "reserved", createdAt: at(6) },
    { id: SOMEONE_ELSES, studentId: OTHER_STUDENT, seatStatus: "confirmed", createdAt: at(7) },
  ].map((row) => ({ ...row, classGroupId: GROUP, planPriceId: PLAN_PRICE })));

  await db.insert(payments).values([
    // Two payments on the confirmed seat: the older one approved, the newer
    // one (next monthly module) still open — the newer one speaks for it.
    { enrollmentId: CONFIRMED, status: "approved", operationNumber: "OPHIST1", createdAt: at(10) },
    { enrollmentId: CONFIRMED, status: "under_review", operationNumber: "OPHIST2", createdAt: at(11) },
    { enrollmentId: RESERVED, status: "pending", operationNumber: "OPHIST3", createdAt: at(12) },
    { enrollmentId: RELEASED, status: "rejected", operationNumber: "OPHIST4", createdAt: at(13) },
    { enrollmentId: RETIRED, status: "approved", operationNumber: "OPHIST5", createdAt: at(14) },
    { enrollmentId: SOMEONE_ELSES, status: "approved", operationNumber: "OPHIST6", createdAt: at(15) },
  ].map((row, i) => ({
    ...row,
    idempotencyKey: `history-integration-${i}`,
    method: "yape",
    amountCents: 12000,
    // A decided payment always says when (payments_decided_at_check).
    decidedAt: row.status === "approved" || row.status === "rejected" ? row.createdAt : null,
  })));
}

describe("StudentEnrollmentHistoryQuery", () => {
  it("lists every live enrollment of the student — not only confirmed ones — newest first", async () => {
    const rows = await query.run(STUDENT);

    expect(rows.map((row) => row.id)).toEqual([NO_PAYMENT, RELEASED, RESERVED, CONFIRMED]);
  });

  it("leaves out retired enrollments and other students' enrollments", async () => {
    const ids = (await query.run(STUDENT)).map((row) => row.id);

    expect(ids).not.toContain(RETIRED);
    expect(ids).not.toContain(SOMEONE_ELSES);
  });

  it("derives each row's status and money from the latest payment, like the ledger", async () => {
    const byId = new Map((await query.run(STUDENT)).map((row) => [row.id, row]));

    expect(byId.get(CONFIRMED)).toMatchObject({
      status: "under_review",
      paymentStatus: "under_review",
      operationNumber: "OPHIST2",
      paidAt: null,
    });
    expect(byId.get(RESERVED)).toMatchObject({ status: "under_review", paymentStatus: "pending", seatStatus: "reserved" });
    expect(byId.get(RELEASED)).toMatchObject({ status: "rejected", paymentStatus: "rejected", seatStatus: "released" });
    expect(byId.get(NO_PAYMENT)).toMatchObject({ paymentId: null, paymentStatus: "pending", operationNumber: null });
    expect(byId.get(CONFIRMED)!.paymentId).not.toBeNull();
  });

  it("labels the row with the course, class group code, teacher, period, plan and frozen price", async () => {
    const [row] = await query.run(STUDENT);

    expect(row).toMatchObject({
      courseName: "Curso (history)",
      classGroupName: "HIST-01",
      teacherName: "Docente de prueba",
      academicPeriodName: "Ciclo de prueba (history integration)",
      planName: "Paquete completo",
      planPriceId: PLAN_PRICE,
      amountCents: 12000,
      currency: "PEN",
    });
    expect(row!.code).toMatch(/^OOC-2026-\d{4}$/);
  });

  it("answers an empty list for a student with no enrollment", async () => {
    expect(await query.run("018f2b5c-3000-7000-8000-0000000000ff")).toEqual([]);
  });
});
