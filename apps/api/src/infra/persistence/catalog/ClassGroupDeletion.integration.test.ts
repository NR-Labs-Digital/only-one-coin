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
  reportClassGroupFacts,
  reportRunFacts,
  seatHolds,
  students,
  waitlistEntries,
} from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleClassGroupDeletionRepository } from "./DrizzleClassGroupDeletionRepository.js";
import { DrizzleCatalogEntryRepository } from "./DrizzleCatalogEntryRepository.js";
import { ListClassGroupsQuery } from "./ListClassGroupsQuery.js";

/**
 * Taking a class group out of the catalog for good (23/11/2026) — deleted
 * when untouched, erased when it has history — against a real, migrated
 * Postgres: the blocker list is SQL the typechecker cannot vouch for,
 * and the delete order has to satisfy every foreign key — a wrong one compiles
 * and fails only here.
 *
 * Runs with `pnpm test:api:db`, each test inside a transaction that is always
 * rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite deletes class groups in a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-1060-7000-8000-000000000001";
const COURSE = "018f2b5c-1060-7000-8000-000000000002";
const PLAN = "018f2b5c-1060-7000-8000-000000000003";
const PRICE = "018f2b5c-1060-7000-8000-000000000004";
const GROUP = "018f2b5c-1060-7000-8000-000000000005";
const OTHER = "018f2b5c-1060-7000-8000-000000000006";
const MISSING = "018f2b5c-1060-7000-8000-0000000000ff";
const ACTOR = "usr_delete_staff";

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

async function rolledBack(fn: (tx: Tx, repository: DrizzleClassGroupDeletionRepository) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await seed(tx);
      await fn(tx, new DrizzleClassGroupDeletionRepository(tx as unknown as Db));
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/** A draft class group with one module run — opened by mistake, nobody touched it yet. */
async function seed(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (delete integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés (delete integration)", language: "Inglés", minAge: 12, modules: 2 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 30000 });
  await classGroup(tx, GROUP, "A-10601");
}

async function classGroup(tx: Tx, id: string, code: string, source?: string): Promise<void> {
  await tx.insert(classGroups).values({
    id,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code,
    capacity: 30,
    status: "enrolling",
    startsOn: new Date("2026-04-01T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    sourceClassGroupId: source ?? null,
  });
  await tx.insert(classGroupModules).values({ id, classGroupId: id, module: 1 });
}

async function student(tx: Tx): Promise<string> {
  const [row] = await tx
    .insert(students)
    .values({
      firstName: "Ana",
      lastName: "Eliminar",
      nationalIdType: "DNI",
      nationalId: "DELETE0001",
      email: "delete.integration@gmail.com",
      phone: "999999999",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      country: "PE",
      region: "Lima",
      city: "Lima",
    })
    .returning({ id: students.id });
  return row!.id;
}

async function hold(tx: Tx, status: "active" | "expired" | "released"): Promise<void> {
  await tx.insert(seatHolds).values({
    classGroupId: GROUP,
    origin: "web",
    status,
    expiresAt: sql`now() + interval '10 minutes'`,
    settledAt: status === "active" ? null : sql`now()`,
  });
}

async function exists(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.select({ id: classGroups.id }).from(classGroups).where(eq(classGroups.id, id));
  return rows.length > 0;
}

const delete_ = (repository: DrizzleClassGroupDeletionRepository, id = GROUP) =>
  repository.delete({ id, actorId: ACTOR, at: new Date() });

describe("deleting a class group nobody touched", () => {
  it("takes the class group, its module runs, the holds nobody used and the derived figures", async () => {
    await rolledBack(async (tx, repository) => {
      await hold(tx, "expired");
      await hold(tx, "released");
      await tx.insert(reportRunFacts).values({
        classGroupModuleId: GROUP,
        enrollments: 0,
        reserved: 0,
        collectedCents: 0,
        pendingCents: 0,
        pendingCount: 0,
        lowGrades: 0,
      });
      await tx.insert(reportClassGroupFacts).values({ classGroupId: GROUP, seatsTaken: 0, capacity: 30 });

      expect(await delete_(repository)).toEqual({ outcome: "deleted" });

      expect(await exists(tx, GROUP)).toBe(false);
      expect(await tx.select().from(classGroupModules).where(eq(classGroupModules.classGroupId, GROUP))).toEqual([]);
      expect(await tx.select().from(seatHolds).where(eq(seatHolds.classGroupId, GROUP))).toEqual([]);
      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "catalog.class_group.deleted"), eq(auditLog.targetId, GROUP)));
      expect(entry?.actorId).toBe(ACTOR);
      expect(entry?.metadata).toMatchObject({ code: "A-10601", courseId: COURSE, academicPeriodId: PERIOD });
    });
  });

  it("deletes a retired one too", async () => {
    await rolledBack(async (tx, repository) => {
      await tx.update(classGroups).set({ deletedAt: new Date() }).where(eq(classGroups.id, GROUP));
      expect(await delete_(repository)).toEqual({ outcome: "deleted" });
    });
  });

  it("answers not_found for an id that is not a class group", async () => {
    await rolledBack(async (_tx, repository) => {
      expect(await delete_(repository, MISSING)).toEqual({ outcome: "not_found" });
    });
  });
});

/** Erased: still in the database, retired, out of every catalog read, never restored. */
async function expectErased(tx: Tx, id: string): Promise<void> {
  const [row] = await tx
    .select({ erasedAt: classGroups.erasedAt, deletedAt: classGroups.deletedAt })
    .from(classGroups)
    .where(eq(classGroups.id, id));
  expect(row?.erasedAt).toBeInstanceOf(Date);
  expect(row?.deletedAt).toBeInstanceOf(Date);
  const listed = await new ListClassGroupsQuery(tx as unknown as Db).run({ periodId: PERIOD });
  expect(listed.map((item) => item.id)).not.toContain(id);
  expect(await new DrizzleCatalogEntryRepository(tx as unknown as Db).find("class_group", id)).toBeNull();
  const [entry] = await tx
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "catalog.class_group.erased"), eq(auditLog.targetId, id)));
  expect(entry?.actorId).toBe(ACTOR);
}

describe("a class group with history is erased, not deleted", () => {
  it("erases one somebody was enrolled in, keeping the enrollment", async () => {
    await rolledBack(async (tx, repository) => {
      const [enrollment] = await tx
        .insert(enrollments)
        .values({
          studentId: await student(tx),
          classGroupId: GROUP,
          classGroupModuleId: GROUP,
          planPriceId: PRICE,
          seatStatus: "confirmed",
        })
        .returning({ id: enrollments.id });
      expect(await delete_(repository)).toEqual({ outcome: "erased", reason: "enrollments" });
      await expectErased(tx, GROUP);
      const kept = await tx.select().from(enrollments).where(eq(enrollments.id, enrollment!.id));
      expect(kept).toHaveLength(1);
    });
  });

  it("keeps the first retirement date of one already retired", async () => {
    await rolledBack(async (tx, repository) => {
      const retiredAt = new Date("2026-11-01T12:00:00.000Z");
      await tx.update(classGroups).set({ deletedAt: retiredAt }).where(eq(classGroups.id, GROUP));
      await tx.insert(waitlistEntries).values({ classGroupId: GROUP, studentId: await student(tx) });
      expect(await delete_(repository)).toEqual({ outcome: "erased", reason: "waitlist" });
      const [row] = await tx.select({ deletedAt: classGroups.deletedAt }).from(classGroups).where(eq(classGroups.id, GROUP));
      expect(row?.deletedAt?.toISOString()).toBe(retiredAt.toISOString());
    });
  });

  it("erases one a checkout is holding a seat in right now", async () => {
    await rolledBack(async (tx, repository) => {
      await hold(tx, "active");
      expect(await delete_(repository)).toEqual({ outcome: "erased", reason: "checkout" });
    });
  });

  it("erases one a later period was copied from, and deletes the copy for real", async () => {
    await rolledBack(async (tx, repository) => {
      await classGroup(tx, OTHER, "A-10602", GROUP);
      expect(await delete_(repository)).toEqual({ outcome: "erased", reason: "copies" });
      expect(await delete_(repository, OTHER)).toEqual({ outcome: "deleted" });
    });
  });

  it("answers not_found when asked again, and nothing restores it", async () => {
    await rolledBack(async (tx, repository) => {
      await hold(tx, "active");
      await delete_(repository);
      expect(await delete_(repository)).toEqual({ outcome: "not_found" });
      const entries = new DrizzleCatalogEntryRepository(tx as unknown as Db);
      await entries.restore("class_group", GROUP);
      const [row] = await tx.select({ deletedAt: classGroups.deletedAt }).from(classGroups).where(eq(classGroups.id, GROUP));
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });
  });
});

describe("the list says the same as the delete", () => {
  it("reports the blocker per class group", async () => {
    await rolledBack(async (tx) => {
      await classGroup(tx, OTHER, "A-10602");
      await hold(tx, "active");
      const items = await new ListClassGroupsQuery(tx as unknown as Db).run({ periodId: PERIOD });
      const blockers = Object.fromEntries(items.map((item) => [item.id, item.deleteBlocker]));
      expect(blockers).toEqual({ [GROUP]: "checkout", [OTHER]: null });
    });
  });
});
