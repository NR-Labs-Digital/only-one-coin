import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, planPrices, plans, students } from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleCatalogEntryRepository } from "./DrizzleCatalogEntryRepository.js";
import type { Db } from "@/infra/db/client.js";

/**
 * The half of the catalog retirement that typecheck cannot vouch for: four
 * different counting queries, each reaching an enrollment by a different path
 * (directly, through plan_prices, through class_groups). A wrong join here
 * compiles perfectly and reports "0 people on it" about a full class group.
 *
 * Runs against a real, migrated Postgres — `pnpm db:up && pnpm db:migrate`,
 * then `DATABASE_URL=... pnpm test:api:db`. In CI it runs in the `migrations`
 * job, where a migrated database already exists.
 *
 * Everything happens inside a transaction that is always rolled back: this
 * suite writes, and it writes to a database somebody else owns. It is also the
 * only way to clean up at all — `students` has no DELETE (CLAUDE.md §6, and
 * migration 0011 enforces it).
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises the catalog repository against a real, migrated Postgres.",
  );
}

const PERIOD = "018f2b5c-1000-7000-8000-000000000001";
const COURSE = "018f2b5c-1000-7000-8000-000000000002";
const PLAN = "018f2b5c-1000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-1000-7000-8000-000000000004";
const CLASS_GROUP = "018f2b5c-1000-7000-8000-000000000005";
const STUDENT = "018f2b5c-1000-7000-8000-000000000006";
const ENROLLMENT = "018f2b5c-1000-7000-8000-000000000007";
const NOT_ON_FILE = "018f2b5c-1000-7000-8000-0000000000ff";

let pool: pg.Pool;
let db: Db;
let repository: DrizzleCatalogEntryRepository;

beforeAll(async () => {
  // A pool of exactly one connection, not a bare Client: `Db` is what
  // drizzle(Pool) produces, so this matches the type the repository is built
  // for — and with max: 1 every statement, BEGIN and ROLLBACK included, lands
  // on the same physical connection, which is what makes the rollback cover
  // the whole test.
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleCatalogEntryRepository(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("begin");
  await seedOneOfEverything();
});

afterEach(async () => {
  await pool.query("rollback");
});

/** One enrollment standing on one class group, reachable from all four kinds. */
async function seedOneOfEverything(): Promise<void> {
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });

  await db.insert(courses).values({
    id: COURSE,
    name: "Inglés Básico (integration)",
    language: "en",
    minAge: 12,
  });

  await db.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });

  await db.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 10000 });

  await db.insert(classGroups).values({
    id: CLASS_GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 20,
  });

  await db.insert(students).values({
    id: STUDENT,
    firstName: "Rosa",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "70000001",
    email: "rosa.integration@gmail.com",
    phone: "+51987654321",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  });

  await db.insert(enrollments).values({
    id: ENROLLMENT,
    studentId: STUDENT,
    classGroupId: CLASS_GROUP,
    planPriceId: PLAN_PRICE,
    seatStatus: "reserved",
  });
}

describe("counting what is still standing on an entry", () => {
  // The one enrollment is reachable from every kind by a different path, so
  // all four must find it — and a join written against the wrong column would
  // quietly answer zero.
  it.each(["class_group", "course", "plan", "academic_period"] as const)(
    "sees the enrollment from %s",
    async (kind) => {
      const ids = {
        class_group: CLASS_GROUP,
        course: COURSE,
        plan: PLAN,
        academic_period: PERIOD,
      };

      expect(await repository.find(kind, ids[kind])).toMatchObject({
        kind,
        retiredAt: null,
        liveEnrollments: 1,
      });
    },
  );

  it("does not count a seat that was already handed back", async () => {
    await db.update(enrollments).set({ seatStatus: "released" }).where(eq(enrollments.id, ENROLLMENT));

    expect(await repository.find("course", COURSE)).toMatchObject({ liveEnrollments: 0 });
  });

  it("does not count a retired enrollment", async () => {
    await db.update(enrollments).set({ deletedAt: new Date() }).where(eq(enrollments.id, ENROLLMENT));

    expect(await repository.find("class_group", CLASS_GROUP)).toMatchObject({ liveEnrollments: 0 });
  });

  it("answers null for an entry that is not on file", async () => {
    expect(await repository.find("course", NOT_ON_FILE)).toBeNull();
  });
});

describe("retiring and restoring", () => {
  it.each(["class_group", "course", "plan", "academic_period"] as const)(
    "marks %s instead of removing it",
    async (kind) => {
      const ids = {
        class_group: CLASS_GROUP,
        course: COURSE,
        plan: PLAN,
        academic_period: PERIOD,
      };
      const at = new Date("2026-09-22T12:00:00.000Z");

      await repository.retire(kind, ids[kind], at);

      expect(await repository.find(kind, ids[kind])).toMatchObject({ retiredAt: at });
    },
  );

  // The `isNull` guard in `retire`: two calls racing must not move when the
  // entry left, the same rule the domain keeps with its idempotent softDelete.
  it("keeps the first retirement date when retired twice", async () => {
    const first = new Date("2026-09-22T12:00:00.000Z");
    const second = new Date("2026-10-01T09:00:00.000Z");

    await repository.retire("course", COURSE, first);
    await repository.retire("course", COURSE, second);

    expect(await repository.find("course", COURSE)).toMatchObject({ retiredAt: first });
  });

  it("puts a retired entry back on offer", async () => {
    await repository.retire("course", COURSE, new Date());

    await repository.restore("course", COURSE);

    expect(await repository.find("course", COURSE)).toMatchObject({ retiredAt: null });
  });

  it("leaves the enrollments alone when the entry is retired", async () => {
    await repository.retire("class_group", CLASS_GROUP, new Date());

    const [row] = await db.select().from(enrollments).where(eq(enrollments.id, ENROLLMENT));

    expect(row).toMatchObject({ id: ENROLLMENT, deletedAt: null, seatStatus: "reserved" });
  });
});
