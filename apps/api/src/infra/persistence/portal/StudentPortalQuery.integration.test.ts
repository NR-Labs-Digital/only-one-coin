import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  guardians,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GetStudentQuery } from "../student/GetStudentQuery.js";
import { StudentPortalQuery } from "./StudentPortalQuery.js";
import type { Db } from "@/infra/db/client.js";
import { insertPasswordlessUser } from "@/infra/auth/credentialAccount.js";

/**
 * The student portal's read (OOC-32): scoped by the account, across every
 * file linked to it, and never reaching another person's enrollment or
 * payment.
 *
 * Runs against a real, migrated Postgres inside a transaction that is always
 * rolled back (`pnpm db:up && pnpm db:migrate`, then `pnpm test:api:db`).
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises StudentPortalQuery against a real, migrated Postgres.",
  );
}

let USER: string;
let OTHER_USER: string;

const PERIOD = "018f2b5c-3100-7000-8000-000000000001";
const COURSE = "018f2b5c-3100-7000-8000-000000000002";
const PLAN = "018f2b5c-3100-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-3100-7000-8000-000000000004";
const GROUP = "018f2b5c-3100-7000-8000-000000000005";
const OLD_FILE = "018f2b5c-3100-7000-8000-000000000006";
const NEW_FILE = "018f2b5c-3100-7000-8000-000000000007";
const STRANGER = "018f2b5c-3100-7000-8000-000000000008";

const ON_OLD_FILE = "018f2b5c-3100-7000-8000-000000000010";
const ON_NEW_FILE = "018f2b5c-3100-7000-8000-000000000011";
const RETIRED = "018f2b5c-3100-7000-8000-000000000012";
const STRANGERS = "018f2b5c-3100-7000-8000-000000000013";

const PAID = "018f2b5c-3100-7000-8000-000000000020";
const WAITING = "018f2b5c-3100-7000-8000-000000000021";
const STRANGERS_PAYMENT = "018f2b5c-3100-7000-8000-000000000022";

let pool: pg.Pool;
let db: Db;
let query: StudentPortalQuery;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  query = new StudentPortalQuery(db, new GetStudentQuery(db));
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

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 12, minute));

async function seed(): Promise<void> {
  USER = await insertPasswordlessUser(db, { email: "portal.query@gmail.com", name: "Portal", role: "student" });
  OTHER_USER = await insertPasswordlessUser(db, { email: "portal.query.other@gmail.com", name: "Otra", role: "student" });
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (portal integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await db.insert(courses).values({
    id: COURSE,
    name: "Curso (portal)",
    language: "Lengua (portal)",
    minAge: 12,
    level: "A1",
    summary: "Resumen del curso",
    certificateRule: "exam_required",
  });
  await db.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await db.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 12000 });
  await db.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun 19:00",
    slots: [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }],
    code: "PORTAL-01",
    teacherName: "Docente de prueba",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 50,
  });

  // Two files of the same person on one account (not consolidated yet,
  // CLAUDE.md §1), and a stranger on another account.
  await db.insert(students).values([
    { id: OLD_FILE, firstName: "Vieja", userId: USER, createdAt: at(0) },
    { id: NEW_FILE, firstName: "Nueva", userId: USER, createdAt: at(1) },
    { id: STRANGER, firstName: "Otra", userId: OTHER_USER, createdAt: at(2) },
  ].map((row, i) => ({
    ...row,
    lastName: "Portal",
    nationalIdType: "DNI",
    nationalId: `PORTAL${i}`,
    email: `portal.${i}@gmail.com`,
    phone: "+51900000000",
    birthDate: new Date("2012-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  })));
  await db.insert(guardians).values({
    studentId: NEW_FILE,
    firstName: "Madre",
    lastName: "Portal",
    relationship: "mother",
    nationalIdType: "DNI",
    nationalId: "PORTALG",
    email: "madre@example.com",
    phone: "+51900000001",
  });

  await db.insert(enrollments).values([
    { id: ON_OLD_FILE, studentId: OLD_FILE, seatStatus: "confirmed", createdAt: at(3) },
    { id: ON_NEW_FILE, studentId: NEW_FILE, seatStatus: "reserved", createdAt: at(4) },
    { id: RETIRED, studentId: NEW_FILE, seatStatus: "confirmed", createdAt: at(5), deletedAt: at(6) },
    { id: STRANGERS, studentId: STRANGER, seatStatus: "confirmed", createdAt: at(7) },
  ].map((row) => ({ ...row, classGroupId: GROUP, planPriceId: PLAN_PRICE })));

  await db.insert(payments).values([
    { id: PAID, enrollmentId: ON_OLD_FILE, status: "approved", createdAt: at(10), updatedAt: at(20), decidedAt: at(20) },
    { id: WAITING, enrollmentId: ON_NEW_FILE, status: "pending", createdAt: at(11), updatedAt: at(11), decidedAt: null },
    { id: STRANGERS_PAYMENT, enrollmentId: STRANGERS, status: "approved", createdAt: at(12), updatedAt: at(12), decidedAt: at(12) },
  ].map((row, i) => ({ ...row, idempotencyKey: `portal-integration-${i}`, method: "yape", amountCents: 12000 })));

  const [hold] = await db
    .insert(seatHolds)
    .values({ classGroupId: GROUP, origin: "web", status: "consumed", enrollmentId: ON_OLD_FILE, settledAt: at(9), expiresAt: at(9) })
    .returning({ id: seatHolds.id });
  await db.insert(receiptUploads).values({
    seatHoldId: hold!.id,
    paymentId: PAID,
    objectKey: "receipts/portal-integration/raw.jpg",
    processedObjectKey: "receipts/portal-integration/processed.jpg",
    status: "processed",
  });
}

describe("StudentPortalQuery.overview", () => {
  it("answers null for an account no file points at", async () => {
    expect(await query.overview("nobody")).toBeNull();
  });

  it("reads the identity off the newest file, with its guardian", async () => {
    const overview = await query.overview(USER);

    expect(overview?.student).toMatchObject({ id: NEW_FILE, firstName: "Nueva", isMinor: true });
    expect(overview?.student.guardian).toMatchObject({ firstName: "Madre", consent: null });
  });

  it("lists the live enrollments of every file on the account, newest first — never a stranger's", async () => {
    const ids = (await query.overview(USER))!.enrollments.map((row) => row.id);

    expect(ids).toEqual([ON_NEW_FILE, ON_OLD_FILE]);
  });

  it("carries the course, class group, frozen price and every payment", async () => {
    const byId = new Map((await query.overview(USER))!.enrollments.map((row) => [row.id, row]));
    const paid = byId.get(ON_OLD_FILE)!;

    expect(paid).toMatchObject({
      status: "active",
      course: { name: "Curso (portal)", level: "A1", requiresCertificationExam: true },
      classGroup: { name: "PORTAL-01", teacherName: "Docente de prueba" },
      plan: { name: "Paquete completo", priceId: PLAN_PRICE, priceCents: 12000 },
    });
    expect(paid.payments).toEqual([
      expect.objectContaining({ id: PAID, status: "approved", settledAt: at(20), hasReceipt: true }),
    ]);
    expect(byId.get(ON_NEW_FILE)).toMatchObject({ status: "under_review" });
    expect(byId.get(ON_NEW_FILE)!.payments).toEqual([
      expect.objectContaining({ id: WAITING, status: "pending", settledAt: null, hasReceipt: false }),
    ]);
  });
});

describe("StudentPortalQuery.ownsPayment", () => {
  it("is true for a payment on any of the account's files", async () => {
    expect(await query.ownsPayment(USER, PAID)).toBe(true);
    expect(await query.ownsPayment(USER, WAITING)).toBe(true);
  });

  it("is false for someone else's payment", async () => {
    expect(await query.ownsPayment(USER, STRANGERS_PAYMENT)).toBe(false);
    expect(await query.ownsPayment(OTHER_USER, PAID)).toBe(false);
  });
});
