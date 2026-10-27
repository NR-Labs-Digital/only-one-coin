import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses } from "@ooc/db";
import { Course, LandingKeyTakenError, Plan, PlanPrice } from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleCatalogEntryRepository } from "./DrizzleCatalogEntryRepository.js";
import { DrizzleCourseRepository } from "./DrizzleCourseRepository.js";
import { DrizzlePlanRepository } from "./DrizzlePlanRepository.js";
import { GetCourseQuery } from "./GetCourseQuery.js";
import { ListCoursesQuery } from "./ListCoursesQuery.js";

/**
 * The OOC-36 acceptance criterion at the storage layer: a course written
 * through the repository is listed live right away and a class group can hang
 * off it. Plus the price history read — ordering and "which one is current"
 * are SQL the typecheck cannot vouch for.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the course catalog against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
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

/**
 * Runs `fn` against a transaction that never commits. Handing the repositories
 * this transaction (not the pool) matters: DrizzlePlanRepository opens its own
 * transaction, which would COMMIT a hand-rolled outer BEGIN on the single
 * connection. On a transaction it becomes a savepoint, so the rollback undoes
 * everything — plan_prices rows cannot be deleted afterwards (migration 0017).
 */
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

const MATERIALS = [1, 2, 3, 4, 5, 6].map((n) => `https://drive.google.com/drive/folders/italiano-m${n}`);

function aCourse(): Course {
  return Course.create({
    name: "Italiano (integration)",
    language: "Italiano",
    level: "A1",
    summary: "Italiano para principiantes.",
    minAge: 13,
    modules: 6,
    moduleMaterials: MATERIALS,
    totalHours: 60,
    certificateRule: "exam_required",
    allowsFreeze: false,
    allowsTransfer: true,
  });
}

describe("course catalog storage", () => {
  it("round-trips every course column", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleCourseRepository(tx);
      const created = await repository.create(aCourse());
      const read = await repository.findById(created.id);

      expect(read).toMatchObject({
        name: "Italiano (integration)",
        certificateRule: "exam_required",
        allowsFreeze: false,
        allowsTransfer: true,
        deletedAt: null,
      });
    });
  });

  it("stores and reads back one material per module, in order (OOC-94)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleCourseRepository(tx);
      const created = await repository.create(aCourse());

      expect((await repository.findById(created.id))?.moduleMaterials).toEqual(MATERIALS);

      const listed = (await new ListCoursesQuery(tx).run()).find((item) => item.id === created.id);
      expect(listed).toMatchObject({ moduleMaterials: MATERIALS, missingModuleMaterials: false });
    });
  });

  it("flags a course written before module materials existed", async () => {
    await inRolledBackTransaction(async (tx) => {
      const [row] = await tx
        .insert(courses)
        .values({ name: "Legacy (integration)", language: "Italiano", minAge: 13, modules: 4 })
        .returning();

      const listed = (await new ListCoursesQuery(tx).run()).find((item) => item.id === row!.id);
      expect(listed).toMatchObject({ moduleMaterials: [], missingModuleMaterials: true });

      const detail = await new GetCourseQuery(tx).run(row!.id);
      expect(detail?.course).toMatchObject({ moduleMaterials: [], missingModuleMaterials: true });
    });
  });

  it("lists a new course as live, and a class group can be opened on it", async () => {
    await inRolledBackTransaction(async (tx) => {
      const course = await new DrizzleCourseRepository(tx).create(aCourse());

      const listed = (await new ListCoursesQuery(tx).run()).find((item) => item.id === course.id);
      expect(listed).toMatchObject({ active: true, classGroupCount: 0, language: "Italiano" });

      const [period] = await tx
        .insert(academicPeriods)
        .values({ name: "Ciclo (integration)", startsOn: new Date("2026-11-01T05:00:00Z"), endsOn: new Date("2027-02-28T05:00:00Z") })
        .returning();
      await tx.insert(classGroups).values({
        courseId: course.id,
        academicPeriodId: period!.id,
        schedule: "",
        startsOn: new Date("2026-11-02T05:00:00Z"),
        endsOn: new Date("2027-01-30T05:00:00Z"),
        capacity: 30,
      });

      const relisted = (await new ListCoursesQuery(tx).run()).find((item) => item.id === course.id);
      expect(relisted?.classGroupCount).toBe(1);
    });
  });

  it("keeps price history and names the current price", async () => {
    await inRolledBackTransaction(async (tx) => {
      const course = await new DrizzleCourseRepository(tx).create(aCourse());
      const plans = new DrizzlePlanRepository(tx);
      const plan = Plan.create({ courseId: course.id, name: "Paquete completo" });
      const first = PlanPrice.schedule({ planId: plan.id, amountCents: 8000 });
      await plans.createWithPrice(plan, first);
      const future = PlanPrice.schedule({ planId: plan.id, amountCents: 9000, validFrom: new Date(Date.now() + 30 * DAY) });
      await plans.addPrice(future);

      const detail = await new GetCourseQuery(tx).run(course.id);

      expect(detail?.plans).toHaveLength(1);
      expect(detail?.plans[0]?.prices.map((price) => price.amountCents)).toEqual([9000, 8000]);
      expect(detail?.plans[0]?.currentPriceId).toBe(first.id);
    });
  });

  it("tells whether a course has a price in force — no price, no checkout", async () => {
    await inRolledBackTransaction(async (tx) => {
      const course = await new DrizzleCourseRepository(tx).create(aCourse());
      const listed = async () => (await new ListCoursesQuery(tx).run()).find((item) => item.id === course.id);

      expect(await listed()).toMatchObject({ planCount: 0, hasPriceInForce: false });

      const plans = new DrizzlePlanRepository(tx);
      const scheduled = Plan.create({ courseId: course.id, name: "Mensual" });
      await plans.createWithPrice(
        scheduled,
        PlanPrice.schedule({ planId: scheduled.id, amountCents: 4000, validFrom: new Date(Date.now() + 30 * DAY) }),
      );
      expect(await listed()).toMatchObject({ planCount: 1, hasPriceInForce: false });
      expect((await new GetCourseQuery(tx).run(course.id))?.course).toMatchObject({ planCount: 1, hasPriceInForce: false });

      // In force since an hour ago: inside a transaction Postgres' now() is the
      // moment it opened, earlier than a price stamped "now" by the app.
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const priced = Plan.create({ courseId: course.id, name: "Paquete completo" });
      await plans.createWithPrice(priced, PlanPrice.schedule({ planId: priced.id, amountCents: 8000 }, anHourAgo));
      expect(await listed()).toMatchObject({ planCount: 2, hasPriceInForce: true });
      expect((await new GetCourseQuery(tx).run(course.id))?.course).toMatchObject({ planCount: 2, hasPriceInForce: true });
    });
  });

  it("answers null for a course not on file", async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(await new GetCourseQuery(tx).run("018f2b5c-1000-7000-8000-0000000000ff")).toBeNull();
    });
  });
});

/**
 * OOC-117: one live course per landing key is the partial unique index's job
 * when two writes race past the usecase's check — and retiring lets go of the
 * key. Each refused write runs in a savepoint (nested transaction): a unique
 * violation aborts the transaction it happens in, and the test still needs to
 * read afterwards.
 */
describe("course landing key storage", () => {
  it("round-trips the key and finds the live holder", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleCourseRepository(tx);
      const created = await repository.create(Course.create({ ...aCourse(), landingKey: "russian" }));

      expect((await repository.findById(created.id))?.landingKey).toBe("russian");
      expect((await repository.findLiveByLandingKey("russian"))?.id).toBe(created.id);
    });
  });

  it("refuses a second live course on the same key", async () => {
    await inRolledBackTransaction(async (tx) => {
      await new DrizzleCourseRepository(tx).create(Course.create({ ...aCourse(), landingKey: "russian" }));

      await expect(
        tx.transaction((savepoint) =>
          new DrizzleCourseRepository(savepoint as unknown as Db).create(Course.create({ ...aCourse(), landingKey: "russian" })),
        ),
      ).rejects.toBeInstanceOf(LandingKeyTakenError);
    });
  });

  it("frees the key on retirement, and refuses to bring the old holder back over the new one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleCourseRepository(tx);
      const entries = new DrizzleCatalogEntryRepository(tx);
      const old = await repository.create(Course.create({ ...aCourse(), landingKey: "russian" }));
      await entries.retire("course", old.id, new Date());

      expect(await repository.findLiveByLandingKey("russian")).toBeNull();
      const replacement = await repository.create(Course.create({ ...aCourse(), landingKey: "russian" }));
      expect((await repository.findLiveByLandingKey("russian"))?.id).toBe(replacement.id);

      await expect(
        tx.transaction((savepoint) => new DrizzleCatalogEntryRepository(savepoint as unknown as Db).restore("course", old.id)),
      ).rejects.toBeInstanceOf(LandingKeyTakenError);
    });
  });
});
