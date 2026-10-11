import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroups,
  courses,
  enrollments,
  payments,
  planPrices,
  plans,
  students,
} from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DashboardSummaryQuery, type DashboardSummary } from "./DashboardSummaryQuery.js";

/**
 * The home's headline numbers (OOC-67), read against Postgres: which approval
 * falls on which Lima day, and who is still studying now and at the end of
 * yesterday — both rebuilt from the audit trail.
 *
 * The figures are global, so rows already in the database count too. Every
 * test reads a baseline first, seeds inside a transaction that is always
 * rolled back, and asserts the difference — never an absolute count.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the dashboard SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-9100-7000-8000-000000000001";
const COURSE = "018f2b5c-9100-7000-8000-000000000002";
const PLAN = "018f2b5c-9100-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-9100-7000-8000-000000000004";

// 10:00 in Lima (UTC-5). Lima's today starts at 05:00Z on the 11th, its
// yesterday at 05:00Z on the 10th.
const NOW = new Date("2026-10-11T15:00:00.000Z");
const TODAY_EARLY = new Date("2026-10-11T05:30:00.000Z"); // 00:30 Lima, today
const YESTERDAY_LATE = new Date("2026-10-11T04:30:00.000Z"); // 23:30 Lima, yesterday
const LONG_AGO = new Date("2026-03-05T15:00:00.000Z");

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

/** Runs `seed` in a rolled-back transaction and hands back the before/after figures. */
async function measure(seed: (tx: Tx) => Promise<void>): Promise<{ before: DashboardSummary; after: DashboardSummary }> {
  let result: { before: DashboardSummary; after: DashboardSummary } | undefined;
  try {
    await db.transaction(async (tx) => {
      const query = new DashboardSummaryQuery(tx as unknown as Db);
      await seedCatalog(tx);
      const before = await query.run(NOW);
      await seed(tx);
      const after = await query.run(NOW);
      result = { before, after };
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  return result!;
}

function delta({ before, after }: { before: DashboardSummary; after: DashboardSummary }): DashboardSummary {
  return {
    enrollmentsToday: after.enrollmentsToday - before.enrollmentsToday,
    enrollmentsYesterday: after.enrollmentsYesterday - before.enrollmentsYesterday,
    activeStudents: after.activeStudents - before.activeStudents,
    activeStudentsYesterday: after.activeStudentsYesterday - before.activeStudentsYesterday,
  };
}

async function seedCatalog(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (dashboard summary integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (dashboard summary integration)", language: "Prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 15000 });
}

let sequence = 0;

async function seedGroup(tx: Tx, status: "enrolling" | "in_progress" | "finished" | "closed"): Promise<string> {
  const [group] = await tx
    .insert(classGroups)
    .values({
      courseId: COURSE,
      academicPeriodId: PERIOD,
      schedule: "Lun/Mié 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-12-30T00:00:00.000Z"),
      capacity: 30,
      seatsTaken: 0,
      status,
    })
    .returning({ id: classGroups.id });
  return group!.id;
}

async function seedStudent(tx: Tx): Promise<string> {
  sequence += 1;
  const tag = `${Date.now()}${sequence}`;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Resumen",
      lastName: `Panel${sequence}`,
      nationalIdType: "DNI",
      nationalId: `DASH${tag}`,
      email: `dash.${tag}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  return student!.id;
}

interface EnrollmentSeed {
  studentId: string;
  groupId: string;
  seatStatus?: "reserved" | "confirmed" | "released";
  /** When the approval was written to the audit trail; null = no trail (seed, legacy import). */
  approvedAt: Date | null;
  deletedAt?: Date;
}

async function seedEnrollment(tx: Tx, seed: EnrollmentSeed): Promise<string> {
  sequence += 1;
  const [enrollment] = await tx
    .insert(enrollments)
    .values({
      studentId: seed.studentId,
      classGroupId: seed.groupId,
      planPriceId: PLAN_PRICE,
      seatStatus: seed.seatStatus ?? "confirmed",
      deletedAt: seed.deletedAt ?? null,
    })
    .returning({ id: enrollments.id });
  const [payment] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: `dashboard-summary-integration-${Date.now()}-${sequence}`,
      status: (seed.seatStatus ?? "confirmed") === "confirmed" ? "approved" : "pending",
      method: "yape",
      amountCents: 15000,
    })
    .returning({ id: payments.id });
  if (seed.approvedAt) {
    await tx.insert(auditLog).values({
      actorId: "dashboard-summary-integration",
      action: "payment.approved",
      targetId: payment!.id,
      metadata: { enrollmentId: enrollment!.id },
      createdAt: seed.approvedAt,
    });
  }
  return enrollment!.id;
}

async function closeGroupAt(tx: Tx, groupId: string, to: "finished" | "closed", at: Date): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: "dashboard-summary-integration",
    action: "catalog.class_group.status_changed",
    targetId: groupId,
    metadata: { from: to === "finished" ? "in_progress" : "finished", to },
    createdAt: at,
  });
}

describe("DashboardSummaryQuery — enrollments of the day", () => {
  it("counts an approval on the Lima day it happened, not the UTC one", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "enrolling");
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: TODAY_EARLY });
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: YESTERDAY_LATE });
      }),
    );

    expect(result.enrollmentsToday).toBe(1);
    expect(result.enrollmentsYesterday).toBe(1);
  });

  it("leaves out an approval after now and one on a retired enrollment", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "enrolling");
        await seedEnrollment(tx, {
          studentId: await seedStudent(tx),
          groupId: group,
          approvedAt: new Date(NOW.getTime() + 60 * 60_000),
        });
        await seedEnrollment(tx, {
          studentId: await seedStudent(tx),
          groupId: group,
          approvedAt: TODAY_EARLY,
          deletedAt: TODAY_EARLY,
        });
      }),
    );

    expect(result.enrollmentsToday).toBe(0);
    expect(result.enrollmentsYesterday).toBe(0);
  });
});

describe("DashboardSummaryQuery — students studying now and at the end of yesterday", () => {
  it("counts a confirmed seat in a running class group, by the day it was approved", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "in_progress");
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: YESTERDAY_LATE });
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: TODAY_EARLY });
      }),
    );

    expect(result.activeStudents).toBe(2);
    expect(result.activeStudentsYesterday).toBe(1);
  });

  it("counts a class group finished today as studying yesterday, not now", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "finished");
        await closeGroupAt(tx, group, "finished", TODAY_EARLY);
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: LONG_AGO });
      }),
    );

    expect(result.activeStudents).toBe(0);
    expect(result.activeStudentsYesterday).toBe(1);
  });

  it("treats a finished class group with no trail as finished since ever", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "closed");
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: LONG_AGO });
      }),
    );

    expect(result.activeStudents).toBe(0);
    expect(result.activeStudentsYesterday).toBe(0);
  });

  it("treats a confirmed seat with no approval trail as confirmed since ever", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "enrolling");
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, approvedAt: null });
      }),
    );

    expect(result.activeStudents).toBe(1);
    expect(result.activeStudentsYesterday).toBe(1);
    expect(result.enrollmentsToday).toBe(0);
  });

  it("leaves out a reserved seat and a retired enrollment, and counts a person once", async () => {
    const result = delta(
      await measure(async (tx) => {
        const group = await seedGroup(tx, "in_progress");
        const other = await seedGroup(tx, "enrolling");
        await seedEnrollment(tx, { studentId: await seedStudent(tx), groupId: group, seatStatus: "reserved", approvedAt: null });
        await seedEnrollment(tx, {
          studentId: await seedStudent(tx),
          groupId: group,
          approvedAt: LONG_AGO,
          deletedAt: LONG_AGO,
        });
        const twice = await seedStudent(tx);
        await seedEnrollment(tx, { studentId: twice, groupId: group, approvedAt: LONG_AGO });
        await seedEnrollment(tx, { studentId: twice, groupId: other, approvedAt: LONG_AGO });
      }),
    );

    expect(result.activeStudents).toBe(1);
    expect(result.activeStudentsYesterday).toBe(1);
  });
});
