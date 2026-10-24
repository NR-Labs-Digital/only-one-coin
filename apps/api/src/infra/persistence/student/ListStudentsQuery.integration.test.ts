import * as schema from "@ooc/db";
import { academicPeriods, auditLog, classGroups, courses, enrollments, planPrices, plans, students } from "@ooc/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import {
  DIRECTORY_PAGE_SIZE,
  EXPORT_BATCH_SIZE,
  ListStudentsQuery,
  STUDENT_DIRECTORY_TARGET,
  type StudentListRow,
} from "./ListStudentsQuery.js";

/**
 * OOC-55: the student directory is people who got in, plus people registered
 * by hand who have not enrolled yet. Someone whose only enrollment is still
 * being settled in Payments is not listed — but the pickers (`search`) still
 * find them, or staff would open a second file.
 *
 * OOC-76: search, status and age run in Postgres over the whole directory,
 * and the counts per chip agree with what each chip would list.
 *
 * OOC-116: "active" means a current enrollment — a confirmed seat in a class
 * group still enrolling or in progress. A confirmed seat in a finished one
 * makes a former student; nothing confirmed, no enrollment.
 *
 * `students` is under the delete lock (migration 0011): every test runs in a
 * transaction that is always rolled back, and every directory read is scoped
 * by a search on this suite's own surname, so other rows never leak in.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises ListStudentsQuery against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-7000-7000-8000-000000000001";
const COURSE = "018f2b5c-7000-7000-8000-000000000002";
const PLAN = "018f2b5c-7000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-7000-7000-8000-000000000004";
const GROUP = "018f2b5c-7000-7000-8000-000000000005";
/** A class group that already finished. */
const GROUP_DONE = "018f2b5c-7000-7000-8000-000000000006";

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

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/** Ten years old today, whatever today is. */
const CHILD = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1));
const ADULT = new Date("2000-01-01T00:00:00.000Z");

/** One student per seat shape: none, reserved only, confirmed, released only,
 * confirmed + reserved, and confirmed in a class group that already finished. */
const SHAPES: {
  name: string;
  seats: ("reserved" | "confirmed" | "released")[];
  /** The seats sit in GROUP_DONE instead of GROUP. */
  finished?: boolean;
  listed: boolean;
  status: "active" | "former" | "under_review" | "no_enrollment";
  birthDate: Date;
}[] = [
  { name: "SinMatricula", seats: [], listed: true, status: "no_enrollment", birthDate: ADULT },
  { name: "SoloReservada", seats: ["reserved"], listed: false, status: "under_review", birthDate: CHILD },
  { name: "Confirmada", seats: ["confirmed"], listed: true, status: "active", birthDate: CHILD },
  { name: "SoloLiberada", seats: ["released"], listed: true, status: "no_enrollment", birthDate: ADULT },
  { name: "ConfirmadaYReservada", seats: ["confirmed", "reserved"], listed: true, status: "active", birthDate: ADULT },
  { name: "Egresada", seats: ["confirmed"], finished: true, listed: true, status: "former", birthDate: ADULT },
];

const SURNAME = "Directorio";

async function seed(tx: Tx): Promise<Map<string, string>> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (students integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (students integration)", language: "Prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 10000 });
  await tx.insert(classGroups).values(
    [
      { id: GROUP, status: "enrolling" },
      { id: GROUP_DONE, status: "finished" },
    ].map((group) => ({
      ...group,
      courseId: COURSE,
      academicPeriodId: PERIOD,
      schedule: "Lun/Mié 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-06-30T00:00:00.000Z"),
      capacity: 50,
    })),
  );

  const rows = await tx
    .insert(students)
    .values(
      SHAPES.map((shape, i) => ({
        firstName: shape.name,
        lastName: SURNAME,
        nationalIdType: "DNI",
        nationalId: `DIRTEST${i}`,
        email: `dir.${i}@gmail.com`,
        phone: "+51900000000",
        birthDate: shape.birthDate,
        country: "PE",
        city: "Lima",
        createdAt: new Date(Date.UTC(2099, 0, 1, 0, i)),
      })),
    )
    .returning({ id: students.id, firstName: students.firstName });
  const idOf = new Map(rows.map((row) => [row.firstName, row.id]));

  const seats = SHAPES.flatMap((shape) =>
    shape.seats.map((seatStatus) => ({
      studentId: idOf.get(shape.name)!,
      classGroupId: shape.finished ? GROUP_DONE : GROUP,
      planPriceId: PLAN_PRICE,
      seatStatus,
    })),
  );
  await tx.insert(enrollments).values(seats);

  return idOf;
}

describe("student directory", () => {
  it("leaves out a student whose only enrollment is still being settled", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const page = await query.directory({ q: SURNAME });

      const listed = new Set(page.items.map((row) => row.id));
      for (const shape of SHAPES) {
        expect(listed.has(idOf.get(shape.name)!), shape.name).toBe(shape.listed);
      }
      expect(page.total).toBe(SHAPES.filter((shape) => shape.listed).length);
    });
  });

  it("filters by status and by age in Postgres, and counts each chip over the search", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const names = (rows: { id: string }[]) =>
        rows.map((row) => [...idOf].find(([, id]) => id === row.id)?.[0]).sort();

      const active = await query.directory({ q: SURNAME, status: "active" });
      expect(names(active.items)).toEqual(["Confirmada", "ConfirmadaYReservada"]);

      const former = await query.directory({ q: SURNAME, status: "former" });
      expect(names(former.items)).toEqual(["Egresada"]);

      const noEnrollment = await query.directory({ q: SURNAME, status: "no_enrollment" });
      expect(names(noEnrollment.items)).toEqual(["SinMatricula", "SoloLiberada"]);

      const minors = await query.directory({ q: SURNAME, minor: true });
      expect(names(minors.items)).toEqual(["Confirmada"]);
      expect(minors.items.every((row) => row.isMinor)).toBe(true);

      // The tabs and chips ignore those filters themselves — same answer either way.
      expect(minors.counts).toEqual({ all: 5, active: 2, former: 1, noEnrollment: 2, minors: 1 });
      expect(active.counts).toEqual(minors.counts);
      expect(former.counts).toEqual(minors.counts);
      expect(active.total).toBe(2);
    });
  });

  it("derives each listed student's status from their seats (OOC-116)", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const all = await query.directory({ q: SURNAME });

      for (const shape of SHAPES.filter((item) => item.listed)) {
        const row = all.items.find((item) => item.id === idOf.get(shape.name));
        expect(row?.status, shape.name).toBe(shape.status);
      }
      // Current enrollments only: the finished class group is not an active course.
      expect(all.items.find((row) => row.id === idOf.get("Egresada"))?.activeCourses).toBe(0);
      expect(all.items.find((row) => row.id === idOf.get("Confirmada"))?.activeCourses).toBe(1);
    });
  });

  it("a class group that finishes moves its students from active to former, with no write on the student", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const names = (rows: { id: string }[]) =>
        rows.map((row) => [...idOf].find(([, id]) => id === row.id)?.[0]).sort();

      await tx.update(classGroups).set({ status: "finished" }).where(eq(classGroups.id, GROUP));

      const active = await query.directory({ q: SURNAME, status: "active" });
      const former = await query.directory({ q: SURNAME, status: "former" });

      expect(active.total).toBe(0);
      expect(names(former.items)).toEqual(["Confirmada", "ConfirmadaYReservada", "Egresada"]);
    });
  });

  it("a closed class group is ended too, and in_progress is current", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      await seed(tx);

      await tx.update(classGroups).set({ status: "in_progress" }).where(eq(classGroups.id, GROUP));
      await tx.update(classGroups).set({ status: "closed" }).where(eq(classGroups.id, GROUP_DONE));
      const page = await query.directory({ q: SURNAME });

      expect(page.counts).toMatchObject({ active: 2, former: 1 });
    });
  });

  it("searches by partial document as well as by name", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const page = await query.directory({ q: "DIRTEST2" });

      expect(page.items.map((row) => row.id)).toEqual([idOf.get("Confirmada")]);
    });
  });
});

describe("pickers (search)", () => {
  it("still finds the student under review, so nobody opens a second file", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const idOf = await seed(tx);
      const found = await query.search("SoloReservada");

      expect(found.map((row) => row.id)).toContain(idOf.get("SoloReservada"));
      expect(found.find((row) => row.id === idOf.get("SoloReservada"))?.status).toBe("under_review");
    });
  });
});

/**
 * Regression for "the students directory stalls around page 3": a bulk insert
 * evaluates `now()` once per statement, so many rows share one timestamp. The
 * directory pages by offset now (OOC-76), ordered by `(created_at, id)`, so
 * the id breaks the tie and every row lands on exactly one page.
 */
describe("pagination across rows that share one timestamp", () => {
  const TIED_ROW_COUNT = DIRECTORY_PAGE_SIZE * 2 + 5;
  const TIED_CREATED_AT = "2026-09-07 18:32:28.541523+00";

  let tiePool: pg.Pool;
  let tieQuery: ListStudentsQuery;

  beforeAll(() => {
    tiePool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    tieQuery = new ListStudentsQuery(drizzle(tiePool, { schema, casing: "snake_case" }));
  });

  afterAll(async () => {
    await tiePool.end();
  });

  beforeEach(async () => {
    await tiePool.query("begin");
  });

  afterEach(async () => {
    await tiePool.query("rollback");
  });

  async function seedTiedBatch(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = await tiePool.query<{ id: string }>(
        `insert into students
           (first_name, last_name, national_id_type, national_id, email, phone, birth_date, country, city, created_at, updated_at)
         values
           ($1, 'Tiedbatch', 'DNI', $2, $3, '+51900000000', '2000-01-01T00:00:00.000Z', 'PE', 'Lima', $4::timestamptz, $4::timestamptz)
         returning id`,
        [`Row${i}`, `TIEDBATCH${i}`, `tied.${i}@gmail.com`, TIED_CREATED_AT],
      );
      ids.push(row.rows[0]!.id);
    }
    return ids;
  }

  it("covers the whole tied batch exactly once across pages", async () => {
    const seededIds = await seedTiedBatch(TIED_ROW_COUNT);

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await tieQuery.directory({ q: "Tiedbatch", page });
      seen.push(...result.items.map((row) => row.id));
      expect(result.total).toBe(TIED_ROW_COUNT);
    }

    expect(seen).toHaveLength(seededIds.length);
    expect(new Set(seen)).toEqual(new Set(seededIds));
  });
});

async function drain(batches: AsyncGenerator<StudentListRow[]>): Promise<StudentListRow[]> {
  const rows: StudentListRow[] = [];
  for await (const batch of batches) rows.push(...batch);
  return rows;
}

/**
 * OOC-121: the export is the directory's filters over every page, and every
 * export leaves an `audit_log` entry — with the filters, never the search text.
 */
describe("directory export", () => {
  const ACTOR = "export-actor-integration";

  it("lists exactly who the same filters list on screen", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      await seed(tx);

      for (const filters of [
        { q: SURNAME },
        { q: SURNAME, status: "active" as const },
        { q: SURNAME, status: "no_enrollment" as const },
        { q: SURNAME, minor: true },
        { q: SURNAME, sort: "oldest" as const },
      ]) {
        const screen = await query.directory(filters);
        const exported = await query.exportDirectory(filters, ACTOR);
        const rows = await drain(exported.batches);

        expect(rows.map((row) => row.id), JSON.stringify(filters)).toEqual(screen.items.map((row) => row.id));
        expect(rows).toEqual(screen.items);
        expect(exported.rowCount).toBe(screen.total);
      }
    });
  });

  it("records who exported, the filters and the row count, never the search text", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      await seed(tx);

      const exported = await query.exportDirectory({ q: SURNAME, status: "active", minor: false }, ACTOR);
      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.actorId, ACTOR), eq(auditLog.action, "student.directory_exported")));

      expect(entry?.targetId).toBe(STUDENT_DIRECTORY_TARGET);
      expect(entry?.metadata).toEqual({ status: "active", minor: false, searched: true, sort: "newest", rowCount: 2 });
      expect(JSON.stringify(entry?.metadata)).not.toContain(SURNAME);
      expect(exported.rowCount).toBe(2);
    });
  });

  it("walks every row once across batches, even when a bulk insert shares one timestamp", async () => {
    await rolledBack(async (tx) => {
      const query = new ListStudentsQuery(tx as unknown as Db);
      const count = EXPORT_BATCH_SIZE + 7;
      const tied = new Date("2026-09-07T18:32:28.541Z");
      const inserted = await tx
        .insert(students)
        .values(
          Array.from({ length: count }, (_, i) => ({
            firstName: `Row${i}`,
            lastName: "Exportbatch",
            nationalIdType: "DNI",
            nationalId: `EXPBATCH${i}`,
            email: `exp.${i}@gmail.com`,
            phone: "+51900000000",
            birthDate: ADULT,
            country: "PE",
            city: "Lima",
            createdAt: tied,
          })),
        )
        .returning({ id: students.id });

      for (const sort of ["newest", "oldest"] as const) {
        const exported = await query.exportDirectory({ q: "Exportbatch", sort }, ACTOR);
        const ids = (await drain(exported.batches)).map((row) => row.id);

        expect(exported.rowCount).toBe(count);
        expect(ids).toHaveLength(count);
        expect(new Set(ids)).toEqual(new Set(inserted.map((row) => row.id)));
      }
    });
  });
});
