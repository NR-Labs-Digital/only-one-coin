import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, planPrices, plans, students } from "@ooc/db";
import { ClassGroupFullError, Enrollment, Payment } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEnrollmentRepository } from "@/infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzleSeatHoldRepository } from "@/infra/persistence/enrollment/DrizzleSeatHoldRepository.js";
import { GetPublicCatalogQuery } from "./GetPublicCatalogQuery.js";
import { ListOpenClassGroupsQuery } from "./ListOpenClassGroupsQuery.js";
import { seedManualReceipt } from "@/tests/fixtures/manualReceipt.js";

/**
 * What "on sale" means (OOC-35), checked where it is written: a draft, a
 * class group outside its enrollment window and one in a retired period are
 * neither listed by the manual-enrollment picker nor by the public checkout,
 * and a draft never takes a seat.
 *
 * Every test runs inside a transaction that never commits: the seat hold
 * repository opens its own transaction (a savepoint here), and plan_prices
 * rows cannot be deleted afterwards (migration 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the open class group reads against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-5900-7000-8000-000000000001";
const RETIRED = "018f2b5c-5900-7000-8000-000000000002";
const COURSE = "018f2b5c-5900-7000-8000-000000000003";
const PLAN = "018f2b5c-5900-7000-8000-000000000004";
const PRICE = "018f2b5c-5900-7000-8000-000000000005";
const ON_SALE = "018f2b5c-5900-7000-8000-000000000011";
const DRAFT = "018f2b5c-5900-7000-8000-000000000012";
const WINDOW_CLOSED = "018f2b5c-5900-7000-8000-000000000013";
const WINDOW_NOT_OPEN = "018f2b5c-5900-7000-8000-000000000014";
const RETIRED_PERIOD = "018f2b5c-5900-7000-8000-000000000015";

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

async function seed(tx: Db): Promise<void> {
  const now = Date.now();
  await tx.insert(academicPeriods).values([
    { id: PERIOD, name: "Ciclo (open class groups integration)", startsOn: new Date(now - 30 * DAY), endsOn: new Date(now + 120 * DAY) },
    {
      id: RETIRED,
      name: "Ciclo retirado (open class groups integration)",
      startsOn: new Date(now - 30 * DAY),
      endsOn: new Date(now + 120 * DAY),
      deletedAt: new Date(now - DAY),
    },
  ]);
  await tx.insert(courses).values({ id: COURSE, name: "Curso (open class groups integration)", language: "Lengua de prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete (open class groups integration)" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) });

  const dated = {
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    slots: [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }],
    startsOn: new Date(now + 7 * DAY),
    endsOn: new Date(now + 90 * DAY),
    capacity: 20,
  };
  await tx.insert(classGroups).values([
    { ...dated, id: ON_SALE, status: "enrolling" },
    {
      id: DRAFT,
      courseId: COURSE,
      academicPeriodId: PERIOD,
      schedule: "",
      capacity: 20,
      status: "draft",
      startsOn: null,
      endsOn: null,
    },
    { ...dated, id: WINDOW_CLOSED, status: "enrolling", enrollmentClosesAt: new Date(now - DAY) },
    { ...dated, id: WINDOW_NOT_OPEN, status: "enrolling", enrollmentOpensAt: new Date(now + DAY) },
    { ...dated, id: RETIRED_PERIOD, academicPeriodId: RETIRED, status: "enrolling" },
  ]);
}

describe("class groups on sale", () => {
  it("lists only class groups on sale now", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const open = await new ListOpenClassGroupsQuery(tx).run();
      const ids = open.map((row) => row.id);
      expect(ids).toContain(ON_SALE);
      expect(ids).not.toContain(DRAFT);
      expect(ids).not.toContain(WINDOW_CLOSED);
      expect(ids).not.toContain(WINDOW_NOT_OPEN);
      expect(ids).not.toContain(RETIRED_PERIOD);

      const onSale = open.find((row) => row.id === ON_SALE);
      expect(onSale?.slots).toEqual([{ weekday: "mon", startTime: "19:00", endTime: "20:30" }]);
    });
  });

  it("the public checkout applies the same filter", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const catalog = await new GetPublicCatalogQuery(tx).run();
      const ids = catalog.classGroups.map((group) => group.id);
      expect(ids).toEqual(expect.arrayContaining([ON_SALE]));
      for (const hidden of [DRAFT, WINDOW_CLOSED, WINDOW_NOT_OPEN, RETIRED_PERIOD]) expect(ids).not.toContain(hidden);
    });
  });

  it("a draft class group never takes a seat", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const result = await new DrizzleSeatHoldRepository(tx).claim({ classGroupId: DRAFT, origin: "web", holdMinutes: 15 });
      expect(result.kind).toBe("not_found");

      const [draft] = await tx.select({ seatsTaken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, DRAFT));
      expect(draft?.seatsTaken).toBe(0);
    });
  });

  it("a class group outside its enrollment window never takes a seat either", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const holds = new DrizzleSeatHoldRepository(tx);
      for (const outside of [WINDOW_CLOSED, WINDOW_NOT_OPEN]) {
        const result = await holds.claim({ classGroupId: outside, origin: "web", holdMinutes: 15 });
        expect(result.kind).toBe("not_found");

        const [row] = await tx.select({ seatsTaken: classGroups.seatsTaken }).from(classGroups).where(eq(classGroups.id, outside));
        expect(row?.seatsTaken).toBe(0);
      }
      expect((await holds.claim({ classGroupId: ON_SALE, origin: "web", holdMinutes: 15 })).kind).toBe("held");
    });
  });

  it("a class group in a retired period never takes a seat at checkout", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const result = await new DrizzleSeatHoldRepository(tx).claim({
        classGroupId: RETIRED_PERIOD,
        origin: "web",
        holdMinutes: 15,
      });
      expect(result.kind).toBe("not_found");

      const [row] = await tx
        .select({ seatsTaken: classGroups.seatsTaken })
        .from(classGroups)
        .where(eq(classGroups.id, RETIRED_PERIOD));
      expect(row?.seatsTaken).toBe(0);
    });
  });

  it("a manual enrollment on a draft is refused like a full class group", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const [student] = await tx
        .insert(students)
        .values({
          firstName: "Alumno",
          lastName: "Borrador",
          nationalIdType: "DNI",
          nationalId: "OPENCG-DRAFT-1",
          email: "open.cg.draft@gmail.com",
          phone: "+51900000000",
          birthDate: new Date("2000-01-01T00:00:00.000Z"),
          country: "PE",
          city: "Lima",
        })
        .returning({ id: students.id });
      const enrollment = Enrollment.createManual({ studentId: student!.id, classGroupId: DRAFT, planPriceId: PRICE });
      const payment = Payment.createManual({
        enrollmentId: enrollment.id,
        method: "yape",
        methodDetail: null,
        amountCents: 9900,
        operationNumber: "OPENCGDRAFT0001",
      });
      const { receipt } = await seedManualReceipt(tx, "usr_open_cg_draft");

      await expect(
        new DrizzleEnrollmentRepository(tx).createWithPayment({ enrollment, payment, notifications: [], receipt }),
      ).rejects.toBeInstanceOf(ClassGroupFullError);
    });
  });

  it("refuses a class group out of draft without dates, and a window that closes before it opens", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      await expect(
        tx.transaction(async (inner) => {
          await inner.update(classGroups).set({ status: "enrolling" }).where(eq(classGroups.id, DRAFT));
        }),
      ).rejects.toThrow();
      await expect(
        tx.transaction(async (inner) => {
          await inner
            .update(classGroups)
            .set({ enrollmentOpensAt: new Date(), enrollmentClosesAt: new Date(Date.now() - DAY) })
            .where(eq(classGroups.id, ON_SALE));
        }),
      ).rejects.toThrow();
    });
  });
});
