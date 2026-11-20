import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  grades,
  paymentLotEnrollments,
  payments,
  planPrices,
  plans,
  students,
  teachers,
} from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { insertPasswordlessUser } from "@/infra/auth/credentialAccount.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";
import { ReportFactsRefresher } from "./ReportFactsRefresher.js";
import { ReportQuery, type ReportResult } from "./ReportQuery.js";

/**
 * The reports' aggregation (OOC-40) against Postgres: the nightly refresh
 * summed over a seeded period, then read back through `ReportQuery`. Everything
 * is scoped to the test's own period, so rows already in the database do not
 * move the figures; the whole run is rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the report SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-9400-7000-8000-000000000001";
const COURSE_A = "018f2b5c-9400-7000-8000-000000000002";
const COURSE_B = "018f2b5c-9400-7000-8000-000000000003";
const PRICE_A = "018f2b5c-9400-7000-8000-000000000004";
const PRICE_B = "018f2b5c-9400-7000-8000-000000000005";
const GROUP_A = "018f2b5c-9400-7000-8000-000000000006";
const GROUP_B = "018f2b5c-9400-7000-8000-000000000007";
const GROUP_DRAFT = "018f2b5c-9400-7000-8000-000000000008";
const TEACHER = "018f2b5c-9400-7000-8000-000000000009";

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

async function seedStudent(tx: Tx): Promise<string> {
  sequence += 1;
  const tag = `${Date.now()}${sequence}`;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Reporte",
      lastName: `Prueba${sequence}`,
      nationalIdType: "DNI",
      nationalId: `REP${tag}`,
      email: `rep.${tag}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  return student!.id;
}

async function seedEnrollment(
  tx: Tx,
  classGroupId: string,
  planPriceId: string,
  seatStatus: "reserved" | "confirmed" | "released",
): Promise<string> {
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: await seedStudent(tx), classGroupId, planPriceId, seatStatus })
    .returning({ id: enrollments.id });
  return enrollment!.id;
}

async function seedPayment(
  tx: Tx,
  enrollmentId: string,
  amountCents: number,
  status: "pending" | "approved" | "rejected",
  decidedAt?: Date,
): Promise<string> {
  sequence += 1;
  const [payment] = await tx
    .insert(payments)
    .values({
      enrollmentId,
      idempotencyKey: `reports-integration-${Date.now()}-${sequence}`,
      status,
      method: "yape",
      amountCents,
      decidedAt: status === "pending" ? null : (decidedAt ?? new Date()),
    })
    .returning({ id: payments.id });
  return payment!.id;
}

/** Seeds the period, refreshes the aggregation and reads it — all inside one rolled-back transaction. */
async function withSeededReport(read: (query: ReportQuery) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(academicPeriods).values({
        id: PERIOD,
        name: "Ciclo de prueba (reports integration)",
        startsOn: new Date("2026-08-01T00:00:00.000Z"),
        endsOn: new Date("2026-12-31T00:00:00.000Z"),
      });
      await tx.insert(courses).values([
        { id: COURSE_A, name: "Curso A (reports)", language: "Prueba", minAge: 12 },
        { id: COURSE_B, name: "Curso B (reports)", language: "Prueba", minAge: 12 },
      ]);
      const [planA, planB] = await tx
        .insert(plans)
        .values([
          { courseId: COURSE_A, name: "Paquete completo" },
          { courseId: COURSE_B, name: "Paquete completo" },
        ])
        .returning({ id: plans.id });
      await tx.insert(planPrices).values([
        { id: PRICE_A, planId: planA!.id, amountCents: 15000 },
        { id: PRICE_B, planId: planB!.id, amountCents: 10000 },
      ]);
      await tx.insert(teachers).values({
        id: TEACHER,
        firstName: "Docente",
        lastName: "Reporte",
        nationalIdType: "DNI",
        nationalId: `REPT${Date.now()}`,
        email: "reports.teacher@example.com",
        phone: "+51900000001",
        nationality: "PE",
        country: "PE",
        city: "Lima",
        addressLine: "Av. de prueba 1",
      });
      const dates = { startsOn: new Date("2026-08-03T00:00:00.000Z"), endsOn: new Date("2026-12-20T00:00:00.000Z") };
      await tx.insert(classGroups).values([
        { id: GROUP_A, courseId: COURSE_A, academicPeriodId: PERIOD, schedule: "Lun 19:00", capacity: 30, seatsTaken: 4, status: "enrolling", teacherId: TEACHER, ...dates },
        { id: GROUP_B, courseId: COURSE_B, academicPeriodId: PERIOD, schedule: "Mar 19:00", capacity: 20, seatsTaken: 3, seatsOver: 1, status: "in_progress", ...dates },
        { id: GROUP_DRAFT, courseId: COURSE_A, academicPeriodId: PERIOD, schedule: "Mié 19:00", capacity: 25, seatsTaken: 0, status: "draft" },
      ]);
      await seedModuleRuns(tx);

      // Course A: one paid, one waiting for its money, one turned down.
      const paid = await seedEnrollment(tx, GROUP_A, PRICE_A, "confirmed");
      await seedPayment(tx, paid, 15000, "approved", new Date("2026-09-10T15:00:00.000Z"));
      const waiting = await seedEnrollment(tx, GROUP_A, PRICE_A, "reserved");
      await seedPayment(tx, waiting, 15000, "pending");
      const refused = await seedEnrollment(tx, GROUP_A, PRICE_A, "released");
      await seedPayment(tx, refused, 15000, "rejected");

      // A lot over both courses, one cent over the sum (OOC-158): the cent
      // goes to the lot's first item, so the pieces add back up.
      const lotHead = await seedEnrollment(tx, GROUP_A, PRICE_A, "confirmed");
      const lotItem = await seedEnrollment(tx, GROUP_B, PRICE_B, "confirmed");
      // 1 Oct 02:00 UTC is still September in Lima.
      const lot = await seedPayment(tx, lotHead, 25001, "approved", new Date("2026-10-01T02:00:00.000Z"));
      await tx.insert(paymentLotEnrollments).values({ paymentId: lot, enrollmentId: lotItem });

      const recordedBy = await insertPasswordlessUser(tx, {
        email: `reports.grader.${Date.now()}@example.com`,
        name: "Supervisión",
        role: "academic_supervisor",
      });
      await tx.insert(grades).values([
        { enrollmentId: paid, classGroupId: GROUP_A, score: 10, recordedBy },
        { enrollmentId: lotHead, classGroupId: GROUP_A, score: 18, recordedBy },
        { enrollmentId: lotItem, classGroupId: GROUP_B, didNotSit: true, recordedBy },
      ]);

      await new ReportFactsRefresher(tx as unknown as Db).refresh();
      await read(new ReportQuery(tx as unknown as Db));
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

function row(report: ReportResult, key: string) {
  return report.rows.find((candidate) => candidate.key === key);
}

describe("reports aggregation", () => {
  it("cuts enrollments, money and seats by course", async () => {
    await withSeededReport(async (query) => {
      const report = await query.run({ period: PERIOD, dimension: "course" });

      expect(report.refreshedAt).toBeInstanceOf(Date);
      expect(report.periodId).toBe(PERIOD);
      expect(report.periods.map((period) => period.id)).toContain(PERIOD);
      expect(row(report, `course:${COURSE_A}`)).toMatchObject({
        label: { kind: "name", name: "Curso A (reports)" },
        sublabel: "Prueba",
        enrollments: 2,
        reserved: 1,
        collectedCents: 15000 + 15001,
        pendingCents: 15000,
        seatsTaken: 4,
        capacity: 30,
        classGroups: 1,
      });
      expect(row(report, `course:${COURSE_B}`)).toMatchObject({
        enrollments: 1,
        reserved: 0,
        collectedCents: 10000,
        pendingCents: 0,
        // Seats above capacity count too (OOC-155).
        seatsTaken: 4,
        capacity: 20,
      });
      expect(report.totals).toEqual({
        enrollments: 3,
        reserved: 1,
        collectedCents: 40001,
        pendingCents: 15000,
        pendingCount: 1,
        seatsTaken: 8,
        capacity: 50,
        // The draft holds no seat and is not counted.
        classGroups: 2,
      });
    });
  });

  it("files each run under its teacher, and the unallocated one under none", async () => {
    await withSeededReport(async (query) => {
      const report = await query.run({ period: PERIOD, dimension: "teacher" });

      expect(row(report, `teacher:${TEACHER}`)).toMatchObject({
        label: { kind: "name", name: "Docente Reporte" },
        enrollments: 2,
        capacity: 30,
      });
      expect(row(report, "teacher:none")).toMatchObject({ label: { kind: "no_teacher" }, enrollments: 1, capacity: 20 });
    });
  });

  it("puts the month line on the Lima calendar and ranks the low grades by course", async () => {
    await withSeededReport(async (query) => {
      const report = await query.run({ period: PERIOD, dimension: "language" });

      expect(report.months).toEqual([{ month: "2026-09", enrollments: 3, collectedCents: 40001 }]);
      expect(report.rankings.lowGrades).toEqual(
        expect.arrayContaining([
          { key: COURSE_A, name: "Curso A (reports)", count: 1 },
          { key: COURSE_B, name: "Curso B (reports)", count: 1 },
        ]),
      );
      expect(report.rankings.volume[0]).toEqual({ key: COURSE_A, name: "Curso A (reports)", count: 2 });
    });
  });
});
