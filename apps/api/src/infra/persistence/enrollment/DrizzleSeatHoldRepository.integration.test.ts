import * as schema from "@ooc/db";
import { academicPeriods, auditLog, classGroups, courses, platformSettings, seatHolds } from "@ooc/db";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzlePlatformSettingsRepository } from "@/infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { DrizzleSeatHoldRepository } from "./DrizzleSeatHoldRepository.js";
import type { Db } from "@/infra/db/client.js";

/**
 * The checkout hold's SQL (apps/api/CLAUDE.md, "Dois relógios") — the part
 * typecheck cannot vouch for, and the part the whole rule rests on: a seat
 * taken exactly once, handed back exactly once, and expired on the database
 * clock.
 *
 * Runs against a real, migrated Postgres (`pnpm test:api:db`). Unlike the
 * ledger suite this cannot wrap each test in a rolled-back transaction: the
 * repository opens its own, and the concurrency test needs several
 * connections at once. So the suite writes its own rows under its own ids and
 * removes them afterwards — none of these tables is under the delete lock of
 * migration 0011.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises DrizzleSeatHoldRepository against a real, migrated Postgres.",
  );
}

const PERIOD = "018f2b5c-5000-7000-8000-000000000001";
const COURSE = "018f2b5c-5000-7000-8000-000000000002";
const GROUP = "018f2b5c-5000-7000-8000-000000000003";
const CLOSED_GROUP = "018f2b5c-5000-7000-8000-000000000004";
const GROUPS = [GROUP, CLOSED_GROUP];

let pool: pg.Pool;
let db: Db;
let repository: DrizzleSeatHoldRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleSeatHoldRepository(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await cleanUp();
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (seat hold integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await db
    .insert(courses)
    .values({ id: COURSE, name: "Curso (seat hold integration)", language: "Lengua de prueba", minAge: 12 });
  await db.insert(classGroups).values(
    [
      { id: GROUP, status: "enrolling" },
      { id: CLOSED_GROUP, status: "closed" },
    ].map((group) => ({
      ...group,
      courseId: COURSE,
      academicPeriodId: PERIOD,
      schedule: "Lun/Mié 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-06-30T00:00:00.000Z"),
      capacity: 2,
    })),
  );
});

afterEach(async () => {
  await cleanUp();
});

async function cleanUp(): Promise<void> {
  await db.delete(seatHolds).where(inArray(seatHolds.classGroupId, GROUPS));
  await db.delete(classGroups).where(inArray(classGroups.id, GROUPS));
  await db.delete(courses).where(eq(courses.id, COURSE));
  await db.delete(academicPeriods).where(eq(academicPeriods.id, PERIOD));
}

async function seatsTaken(groupId = GROUP): Promise<number> {
  const [row] = await db.select({ seatsTaken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, groupId));
  return row!.seatsTaken;
}

async function statusOf(holdId: string): Promise<string> {
  const [row] = await db.select({ status: seatHolds.status }).from(seatHolds).where(eq(seatHolds.id, holdId));
  return row!.status;
}

/** Moves a hold's deadline into the past, as if its minutes had run out. */
async function runOut(holdId: string): Promise<void> {
  await db
    .update(seatHolds)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(eq(seatHolds.id, holdId));
}

async function claim(origin: "whatsapp" | "web" = "web", classGroupId = GROUP) {
  return repository.claim({ classGroupId, origin, holdMinutes: 15 });
}

describe("DrizzleSeatHoldRepository.claim", () => {
  it("takes a seat and records the channel with a deadline on the database clock", async () => {
    const result = await claim("whatsapp");

    expect(result.kind).toBe("held");
    if (result.kind !== "held") return;
    expect(result.hold.origin).toBe("whatsapp");
    expect(await seatsTaken()).toBe(1);

    const [{ minutes }] = (
      await db.execute<{ minutes: number }>(
        sql`select extract(epoch from (${seatHolds.expiresAt} - now())) / 60 as minutes from ${seatHolds} where ${seatHolds.id} = ${result.hold.id}`,
      )
    ).rows as [{ minutes: number }];
    expect(Number(minutes)).toBeGreaterThan(14.9);
    expect(Number(minutes)).toBeLessThanOrEqual(15);
  });

  it("answers full once capacity is reached, and leaves the counter alone", async () => {
    await claim();
    await claim();

    expect((await claim()).kind).toBe("full");
    expect(await seatsTaken()).toBe(2);
  });

  it("answers not_found for a class group that is not enrolling", async () => {
    expect((await claim("web", CLOSED_GROUP)).kind).toBe("not_found");
    expect(await seatsTaken(CLOSED_GROUP)).toBe(0);
  });

  it("never sells more seats than there are, however many claims arrive at once", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => claim()));

    expect(results.filter((result) => result.kind === "held")).toHaveLength(2);
    expect(results.filter((result) => result.kind === "full")).toHaveLength(4);
    expect(await seatsTaken()).toBe(2);
  });
});

describe("DrizzleSeatHoldRepository.release", () => {
  it("gives the seat back once, however many times it is asked", async () => {
    const result = await claim();
    if (result.kind !== "held") throw new Error("expected a hold");

    expect(await repository.release(result.hold.id)).toBe(true);
    expect(await repository.release(result.hold.id)).toBe(false);

    expect(await seatsTaken()).toBe(0);
    expect(await statusOf(result.hold.id)).toBe("released");
  });
});

describe("DrizzleSeatHoldRepository.expireDue", () => {
  it("hands back the seats of holds whose clock ran out, and only those", async () => {
    const due = await claim();
    const alive = await claim();
    if (due.kind !== "held" || alive.kind !== "held") throw new Error("expected two holds");
    await runOut(due.hold.id);

    expect(await repository.expireDue(500)).toBeGreaterThanOrEqual(1);

    expect(await statusOf(due.hold.id)).toBe("expired");
    expect(await statusOf(alive.hold.id)).toBe("active");
    expect(await seatsTaken()).toBe(1);
  });

  it("never hands the same seat back twice", async () => {
    const result = await claim();
    if (result.kind !== "held") throw new Error("expected a hold");
    await runOut(result.hold.id);

    await Promise.all([repository.expireDue(500), repository.expireDue(500)]);
    await repository.expireDue(500);

    expect(await seatsTaken()).toBe(0);
    expect(await statusOf(result.hold.id)).toBe("expired");
  });

  it("does not return a seat whose hold was already released", async () => {
    const result = await claim();
    if (result.kind !== "held") throw new Error("expected a hold");
    await runOut(result.hold.id);
    await repository.release(result.hold.id);

    await repository.expireDue(500);

    expect(await seatsTaken()).toBe(0);
    expect(await statusOf(result.hold.id)).toBe("released");
  });
});

describe("DrizzlePlatformSettingsRepository", () => {
  const ACTOR = "integration-test";
  class RolledBack extends Error {}

  /** audit_log is append-only (0011): every write here is rolled back. */
  async function rolledBack(fn: (tx: Db) => Promise<void>): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        throw new RolledBack();
      });
    } catch (error) {
      if (!(error instanceof RolledBack)) throw error;
    }
  }

  const entry = (column: string, from: number, to: number) => ({
    actorId: ACTOR,
    action: `platform_settings.${column}`,
    targetId: column,
    metadata: { from, to },
    at: new Date(),
  });

  it("reads the row migration 0014 created, with every OOC-41 column at its default", async () => {
    const settings = await new DrizzlePlatformSettingsRepository(db).get();
    expect(Object.keys(settings).sort()).toEqual(
      [
        "certificateDeadlineBusinessDays",
        "checkoutHoldMinutes",
        "constanciaFeeCents",
        "contractAlertDays",
        "ocrLowConfidencePercent",
        "passingGrade",
        "receiptAmountToleranceCents",
        "receiptRejectBelowPercent",
        "reviewWindowDays",
      ].sort(),
    );
  });

  it("writes only the changed columns over the one row, with their audit entries", async () => {
    await rolledBack(async (tx) => {
      const settings = new DrizzlePlatformSettingsRepository(tx);
      const before = await settings.get();

      await settings.update({
        changes: { receiptAmountToleranceCents: 50, reviewWindowDays: 7 },
        actorId: ACTOR,
        audit: [entry("receipt_amount_tolerance_cents", before.receiptAmountToleranceCents, 50), entry("review_window_days", before.reviewWindowDays, 7)],
      });

      expect(await settings.get()).toEqual({ ...before, receiptAmountToleranceCents: 50, reviewWindowDays: 7 });
      expect(await tx.select().from(platformSettings)).toHaveLength(1);
      const trail = await tx
        .select({ action: auditLog.action, metadata: auditLog.metadata })
        .from(auditLog)
        .where(eq(auditLog.actorId, ACTOR));
      expect(trail.map((row) => row.action).sort()).toEqual([
        "platform_settings.receipt_amount_tolerance_cents",
        "platform_settings.review_window_days",
      ]);
    });
  });

  it.each([
    ["checkoutHoldMinutes", 0],
    ["receiptAmountToleranceCents", 5001],
    ["receiptRejectBelowPercent", 100],
    ["reviewWindowDays", 31],
    ["ocrLowConfidencePercent", 96],
    ["passingGrade", 21],
    ["certificateDeadlineBusinessDays", 0],
    ["constanciaFeeCents", 0],
    ["contractAlertDays", 181],
  ] as const)("is refused by the database: %s = %s", async (key, value) => {
    await rolledBack(async (tx) => {
      await expect(
        new DrizzlePlatformSettingsRepository(tx).update({ changes: { [key]: value }, actorId: ACTOR, audit: [] }),
      ).rejects.toThrow();
    });
  });
});
