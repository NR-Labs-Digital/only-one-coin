import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ListEnrollmentsQuery, PAGE_SIZE } from "./ListEnrollmentsQuery.js";
import type { Db } from "@/infra/db/client.js";

/**
 * The ledger's filters, search and paging moved from the browser into SQL —
 * and SQL is exactly what typecheck cannot vouch for. The status filter has to
 * agree with `deriveStatus` row for row, and the tracking code rebuilt in SQL
 * has to agree with `trackingCode` character for character, or a code read out
 * on the phone finds nothing.
 *
 * Runs against a real, migrated Postgres — `pnpm db:up && pnpm db:migrate`,
 * then `DATABASE_URL=... pnpm test:api:db`. Everything happens inside a
 * transaction that is always rolled back, and every query is scoped to this
 * suite's own academic period, so rows already in the database never leak in.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises ListEnrollmentsQuery against a real, migrated Postgres.",
  );
}

const PERIOD = "018f2b5c-2000-7000-8000-000000000001";
const COURSE_A = "018f2b5c-2000-7000-8000-000000000002";
const COURSE_B = "018f2b5c-2000-7000-8000-000000000003";
const PLAN = "018f2b5c-2000-7000-8000-000000000004";
const PLAN_PRICE = "018f2b5c-2000-7000-8000-000000000005";
const GROUP_A = "018f2b5c-2000-7000-8000-000000000006";
const GROUP_B = "018f2b5c-2000-7000-8000-000000000007";

const LANGUAGE_A = "Lengua de prueba A (integration)";
const LANGUAGE_B = "Lengua de prueba B (integration)";

/** Seat × latest payment. Only the first two are enrollments; the rest are
 * still being settled in Payments and must never reach the ledger. */
const COMBOS: { seat: "reserved" | "confirmed" | "released"; payment: string | null }[] = [
  { seat: "confirmed", payment: "approved" },
  { seat: "confirmed", payment: "under_review" },
  { seat: "reserved", payment: "pending" },
  { seat: "released", payment: "rejected" },
];

const ENROLLMENT_COUNT = 40;

const isVisible = (i: number) => COMBOS[i % COMBOS.length]!.seat === "confirmed";
const VISIBLE = Array.from({ length: ENROLLMENT_COUNT }, (_, i) => i).filter(isVisible);

let pool: pg.Pool;
let db: Db;
let query: ListEnrollmentsQuery;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  query = new ListEnrollmentsQuery(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("begin");
  await seedLedger();
});

afterEach(async () => {
  await pool.query("rollback");
});

async function seedLedger(): Promise<void> {
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (ledger integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });

  await db.insert(courses).values([
    { id: COURSE_A, name: "Curso A (integration)", language: LANGUAGE_A, minAge: 12 },
    { id: COURSE_B, name: "Curso B (integration)", language: LANGUAGE_B, minAge: 12 },
  ]);

  await db.insert(plans).values({ id: PLAN, courseId: COURSE_A, name: "Paquete completo" });
  await db.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 10000 });

  await db.insert(classGroups).values(
    [
      { id: GROUP_A, courseId: COURSE_A },
      { id: GROUP_B, courseId: COURSE_B },
    ].map((group) => ({
      ...group,
      academicPeriodId: PERIOD,
      schedule: "Lun/Mié 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-06-30T00:00:00.000Z"),
      capacity: 50,
    })),
  );

  // Batched, one statement per table: against a managed Postgres every
  // round trip costs ~140ms, and one insert per row would spend the hook
  // timeout before a single test ran.
  const indexes = Array.from({ length: ENROLLMENT_COUNT }, (_, i) => i);

  const studentRows = await db
    .insert(students)
    .values(
      indexes.map((i) => ({
        firstName: `Alumno${i}`,
        lastName: "Ledger",
        nationalIdType: "DNI",
        nationalId: `LEDGER${i}`,
        email: `ledger.${i}@gmail.com`,
        phone: "+51900000000",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        country: "PE",
        city: "Lima",
      })),
    )
    .returning({ id: students.id, nationalId: students.nationalId });
  const studentIdOf = new Map(studentRows.map((row) => [row.nationalId, row.id]));

  const enrollmentRows = await db
    .insert(enrollments)
    .values(
      indexes.map((i) => ({
        studentId: studentIdOf.get(`LEDGER${i}`)!,
        // Even rows on course A, odd on course B: 10 each.
        classGroupId: i % 2 === 0 ? GROUP_A : GROUP_B,
        planPriceId: PLAN_PRICE,
        seatStatus: COMBOS[i % COMBOS.length]!.seat,
        // One minute apart, so "newest first" has a single right answer.
        createdAt: new Date(Date.UTC(2026, 2, 1, 12, i)),
      })),
    )
    .returning({ id: enrollments.id, studentId: enrollments.studentId });
  const enrollmentIdOf = new Map(enrollmentRows.map((row) => [row.studentId, row.id]));

  const paymentRows = indexes
    .filter((i) => COMBOS[i % COMBOS.length]!.payment !== null)
    .map((i) => ({
      enrollmentId: enrollmentIdOf.get(studentIdOf.get(`LEDGER${i}`)!)!,
      idempotencyKey: `ledger-integration-${i}`,
      status: COMBOS[i % COMBOS.length]!.payment!,
      // A decided payment always says when (payments_decided_at_check).
      decidedAt: ["approved", "rejected"].includes(COMBOS[i % COMBOS.length]!.payment!) ? new Date() : null,
      method: "yape",
      amountCents: 10000,
      operationNumber: `OPLEDGER${String(i).padStart(4, "0")}`,
    }));
  await db.insert(payments).values(paymentRows);
}

/** Every row of this suite's period, walking the pages. */
async function readAll(filters: Parameters<ListEnrollmentsQuery["run"]>[0] = {}) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await query.run({ ...filters, academicPeriodId: PERIOD, page });
    rows.push(...result.items);
    if (result.items.length < PAGE_SIZE) return { rows, total: result.total };
  }
}

describe("visibility", () => {
  it("lists only enrollments whose seat is confirmed", async () => {
    const all = await readAll();

    expect(all.total).toBe(VISIBLE.length);
    expect(all.rows.every((row) => row.seatStatus === "confirmed")).toBe(true);
  });

  it("does not find a reserved enrollment even by its operation number", async () => {
    const found = await readAll({ q: "OPLEDGER0002" });

    expect(found.total).toBe(0);
  });
});

describe("paging", () => {
  it("splits the ledger into pages that cover every row once, newest first", async () => {
    const first = await query.run({ academicPeriodId: PERIOD, page: 1 });
    const second = await query.run({ academicPeriodId: PERIOD, page: 2 });

    expect(first.total).toBe(VISIBLE.length);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(second.items).toHaveLength(VISIBLE.length - PAGE_SIZE);

    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(VISIBLE.length);

    const times = [...first.items, ...second.items].map((row) => row.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("reverses the order for oldest first", async () => {
    const newest = await readAll();
    const oldest = await readAll({ sort: "oldest" });

    expect(oldest.rows.map((row) => row.id)).toEqual(newest.rows.map((row) => row.id).reverse());
  });
});

describe("filters", () => {
  it("filters by language", async () => {
    const filtered = await readAll({ language: LANGUAGE_B });

    expect(filtered.total).toBe(VISIBLE.filter((i) => i % 2 === 1).length);
    expect(filtered.rows.every((row) => row.language?.name === LANGUAGE_B)).toBe(true);
  });

  it("offers every language and period in the catalog, not only the ones on the page", async () => {
    const result = await query.run({ academicPeriodId: PERIOD, language: LANGUAGE_A });

    expect(result.filterOptions.languages).toEqual(expect.arrayContaining([LANGUAGE_A, LANGUAGE_B]));
    expect(result.filterOptions.periods).toEqual(
      expect.arrayContaining([{ id: PERIOD, name: "Ciclo de prueba (ledger integration)" }]),
    );
  });
});

describe("search", () => {
  it("finds every row by the tracking code the student was given", async () => {
    const all = await readAll();

    for (const row of all.rows) {
      const found = await query.run({ academicPeriodId: PERIOD, q: row.code });
      expect(found.items.map((item) => item.id)).toContain(row.id);
    }
  }, 60_000);

  it("finds a row by the operation number on its latest payment", async () => {
    const found = await readAll({ q: "OPLEDGER0004" });

    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]!.operationNumber).toBe("OPLEDGER0004");
  });

  it("finds rows by student name", async () => {
    const found = await readAll({ q: "Alumno1" });

    const expected = VISIBLE.filter((i) => `Alumno${i}`.includes("Alumno1")).length;
    expect(found.total).toBe(expected);
  });
});

describe("tabs (OOC-115)", () => {
  // Even rows sit on GROUP_A, odd rows on GROUP_B.
  const visibleOn = (group: "A" | "B") => VISIBLE.filter((i) => (i % 2 === 0) === (group === "A"));

  it("a class group still selling or running is current", async () => {
    await db.update(classGroups).set({ status: "in_progress" }).where(eq(classGroups.id, GROUP_B));

    const current = await readAll({ state: "current" });
    const ended = await readAll({ state: "ended" });

    expect(current.total).toBe(VISIBLE.length);
    expect(ended.total).toBe(0);
  });

  it("a finished or closed class group moves its enrollments to ended, with no write on the enrollment", async () => {
    await db.update(classGroups).set({ status: "finished" }).where(eq(classGroups.id, GROUP_B));

    const current = await readAll({ state: "current" });
    const ended = await readAll({ state: "ended" });
    const all = await readAll();

    expect(current.total).toBe(visibleOn("A").length);
    expect(ended.total).toBe(visibleOn("B").length);
    expect(ended.rows.every((row) => row.classGroupStatus === "finished")).toBe(true);
    expect(all.total).toBe(VISIBLE.length);

    await db.update(classGroups).set({ status: "closed" }).where(eq(classGroups.id, GROUP_B));
    expect((await readAll({ state: "ended" })).total).toBe(visibleOn("B").length);
  });

  it("counts every tab under the other filters, whichever tab is on screen", async () => {
    await db.update(classGroups).set({ status: "finished" }).where(eq(classGroups.id, GROUP_B));

    const onCurrent = await query.run({ academicPeriodId: PERIOD, state: "current" });
    const onEnded = await query.run({ academicPeriodId: PERIOD, state: "ended" });
    const narrowed = await query.run({ academicPeriodId: PERIOD, state: "current", language: LANGUAGE_B });

    const expected = { current: visibleOn("A").length, ended: visibleOn("B").length, all: VISIBLE.length };
    expect(onCurrent.counts).toEqual(expected);
    expect(onEnded.counts).toEqual(expected);
    expect(narrowed.counts).toEqual({ current: 0, ended: visibleOn("B").length, all: visibleOn("B").length });
    expect(narrowed.total).toBe(0);
  });

  it("an enrollment on a retired class group still lists under ended and all", async () => {
    await db
      .update(classGroups)
      .set({ status: "closed", deletedAt: new Date() })
      .where(eq(classGroups.id, GROUP_B));

    const ended = await readAll({ state: "ended" });
    const all = await readAll();

    expect(ended.total).toBe(visibleOn("B").length);
    expect(all.total).toBe(VISIBLE.length);
  });

  it("a draft class group is in neither tab", async () => {
    // Unreachable through the product (a draft takes no seat); written by hand
    // to pin that neither tab claims it if one ever appears.
    await db.update(classGroups).set({ status: "draft" }).where(eq(classGroups.id, GROUP_B));

    const current = await query.run({ academicPeriodId: PERIOD, state: "current" });
    const ended = await query.run({ academicPeriodId: PERIOD, state: "ended" });

    expect(current.total).toBe(visibleOn("A").length);
    expect(ended.total).toBe(0);
    expect(current.counts).toEqual({ current: visibleOn("A").length, ended: 0, all: VISIBLE.length });
  });
});
