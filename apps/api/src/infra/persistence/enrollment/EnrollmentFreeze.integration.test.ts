import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroupModules,
  classGroups,
  courses,
  enrollmentFreezeReturns,
  enrollmentFreezes,
  enrollments,
  outbox,
  planPrices,
  plans,
  students,
} from "@ooc/db";
import {
  ClassGroupFullError,
  EnrollmentFreezeConflictError,
  EnrollmentFreezeRefusedError,
  EnrollmentReturnRefusedError,
  FreezeEnrollmentUseCase,
  ReturnFromFreezeUseCase,
  SendFreezeReengagementUseCase,
} from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ClassGroupRosterQuery } from "@/infra/persistence/catalog/ClassGroupRosterQuery.js";
import { DrizzleEnrollmentFreezeRepository } from "./DrizzleEnrollmentFreezeRepository.js";
import { DrizzleFreezeReengagementRepository } from "./DrizzleFreezeReengagementRepository.js";
import { ListEnrollmentsQuery } from "./ListEnrollmentsQuery.js";

/**
 * Freezing an enrollment and bringing it back (OOC-84), against the real SQL:
 * the seat counters, the frozen seat in the ledger and the roster, the return
 * to the module it stopped in, and the re-engagement e-mails. Every test runs
 * in a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the freeze SQL against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-8400-7000-8000-000000000001";
const COURSE = "018f2b5c-8400-7000-8000-000000000002";
const PLAN = "018f2b5c-8400-7000-8000-000000000003";
const PRICE = "018f2b5c-8400-7000-8000-000000000004";
const GROUP = "018f2b5c-8400-7000-8000-000000000005";
const RUN_2 = "018f2b5c-8400-7000-8000-000000000006";
const LATER = "018f2b5c-8400-7000-8000-000000000007";
const LATER_RUN_2 = "018f2b5c-8400-7000-8000-000000000008";
const STAFF = "usr_freeze_staff";
const COURSE_NAME = "Inglés (freeze integration)";

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

interface Seeded {
  enrollmentId: string;
  repository: DrizzleEnrollmentFreezeRepository;
}

async function rolledBack(fn: (tx: Tx, seeded: Seeded) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx, await seed(tx));
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/** A student in module 2 of a running class group, and a later class group with a module 2 run. */
async function seed(tx: Tx): Promise<Seeded> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${STAFF}, 'Coordinación', 'freeze.staff@test.local', true, 'enrollment_supervisor', now(), now())`,
  );
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (freeze integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: COURSE_NAME, language: "Inglés", minAge: 12, modules: 3 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 30000 });
  const group = (id: string, code: string, startsOn: string, seatsTaken: number, capacity = 30) => ({
    id,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code,
    startsOn: new Date(startsOn),
    endsOn: new Date("2026-12-01T00:00:00.000Z"),
    capacity,
    seatsTaken,
    status: "in_progress" as const,
  });
  await tx.insert(classGroups).values([group(GROUP, "A-08401", "2026-03-02T00:00:00.000Z", 1), group(LATER, "A-08402", "2026-08-03T00:00:00.000Z", 0)]);
  await tx.insert(classGroupModules).values([
    { id: GROUP, classGroupId: GROUP, module: 1 },
    { id: RUN_2, classGroupId: GROUP, module: 2 },
    { id: LATER, classGroupId: LATER, module: 1 },
    { id: LATER_RUN_2, classGroupId: LATER, module: 2 },
  ]);
  const [student] = await tx
    .insert(students)
    .values({
      firstName: "Congelada",
      lastName: "Integración",
      nationalIdType: "DNI",
      nationalId: "FREEZE0001",
      email: "freeze.integration@gmail.com",
      phone: "999999999",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      country: "PE",
      region: "Lima",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, classGroupModuleId: RUN_2, planPriceId: PRICE, seatStatus: "confirmed" })
    .returning({ id: enrollments.id });
  return { enrollmentId: enrollment!.id, repository: new DrizzleEnrollmentFreezeRepository(tx as unknown as Db) };
}

const freezeOf = (repository: DrizzleEnrollmentFreezeRepository) => new FreezeEnrollmentUseCase(repository, true);

async function seatsTaken(tx: Tx, id: string) {
  const [row] = await tx.select({ taken: classGroups.seatsTaken, over: classGroups.seatsOver }).from(classGroups).where(eq(classGroups.id, id));
  return row!;
}

async function enrollmentRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(enrollments).where(eq(enrollments.id, id));
  return row!;
}

describe("enrollment freeze (OOC-84)", { timeout: 30_000 }, () => {
  it("freezing gives the seat back and records where the student stopped", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      const { freezeId } = await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "Viaje" });

      expect((await enrollmentRow(tx, enrollmentId)).seatStatus).toBe("frozen");
      expect((await seatsTaken(tx, GROUP)).taken).toBe(0);
      const [freeze] = await tx.select().from(enrollmentFreezes).where(eq(enrollmentFreezes.id, freezeId));
      expect(freeze).toMatchObject({ classGroupId: GROUP, classGroupModuleId: RUN_2, module: 2, attempt: 1, reason: "Viaje" });
    });
  });

  it("refuses a reason left empty, a course that does not allow it, and freezing twice", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      await expect(freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "  " })).rejects.toBeInstanceOf(
        EnrollmentFreezeRefusedError,
      );

      await tx.update(courses).set({ allowsFreeze: false }).where(eq(courses.id, COURSE));
      await expect(freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" })).rejects.toBeInstanceOf(
        EnrollmentFreezeRefusedError,
      );
      await tx.update(courses).set({ allowsFreeze: true }).where(eq(courses.id, COURSE));

      await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" });
      await expect(freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" })).rejects.toBeInstanceOf(
        EnrollmentFreezeRefusedError,
      );
      expect((await seatsTaken(tx, GROUP)).taken).toBe(0);
    });
  });

  it("a freeze read before a change refuses instead of freezing twice", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      const source = (await repository.findSource(enrollmentId))!;
      await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "first" });
      await expect(
        repository.freeze({ source, frozenBy: STAFF, reason: "second", audit: { actorId: STAFF, action: "enrollment.frozen", at: new Date() } }),
      ).rejects.toBeInstanceOf(EnrollmentFreezeConflictError);
      expect((await seatsTaken(tx, GROUP)).taken).toBe(0);
    });
  });

  it("the ledger and the roster still show the frozen seat, marked", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" });

      const ledger = await new ListEnrollmentsQuery(tx as unknown as Db).run({ q: COURSE_NAME });
      expect(ledger.items.find((row) => row.id === enrollmentId)).toMatchObject({ academicStatus: "frozen", seatStatus: "frozen" });

      const roster = new ClassGroupRosterQuery(tx as unknown as Db);
      expect((await roster.run(GROUP, { includeFrozen: true }))!.map((row) => row.academicStatus)).toEqual(["frozen"]);
      // The teacher's roster never sees it.
      expect(await roster.run(GROUP)).toEqual([]);
    });
  });

  it("comes back only to a run of the module it stopped in, taking a seat there", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" });
      const back = new ReturnFromFreezeUseCase(repository);

      await expect(
        back.run({ actorId: STAFF, enrollmentId, classGroupModuleId: LATER, allowOverCapacity: false }),
      ).rejects.toBeInstanceOf(EnrollmentReturnRefusedError);

      expect((await repository.listReturnRuns({ courseId: COURSE, module: 2 })).map((run) => run.id).sort()).toEqual(
        [LATER_RUN_2, RUN_2].sort(),
      );

      await back.run({ actorId: STAFF, enrollmentId, classGroupModuleId: LATER_RUN_2, allowOverCapacity: false });
      expect(await enrollmentRow(tx, enrollmentId)).toMatchObject({
        seatStatus: "confirmed",
        classGroupId: LATER,
        classGroupModuleId: LATER_RUN_2,
        moduleAttempt: 1,
        overCapacity: false,
      });
      expect((await seatsTaken(tx, LATER)).taken).toBe(1);
      expect(await tx.select().from(enrollmentFreezeReturns)).toHaveLength(1);

      // Not frozen any more: nothing to come back from.
      await expect(
        back.run({ actorId: STAFF, enrollmentId, classGroupModuleId: LATER_RUN_2, allowOverCapacity: false }),
      ).rejects.toBeInstanceOf(EnrollmentReturnRefusedError);
    });
  });

  it("a full class group asks first, and takes the seat above capacity when told to", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" });
      await tx.update(classGroups).set({ capacity: 1, seatsTaken: 1 }).where(eq(classGroups.id, LATER));
      const back = new ReturnFromFreezeUseCase(repository);

      await expect(
        back.run({ actorId: STAFF, enrollmentId, classGroupModuleId: LATER_RUN_2, allowOverCapacity: false }),
      ).rejects.toBeInstanceOf(ClassGroupFullError);
      expect((await enrollmentRow(tx, enrollmentId)).seatStatus).toBe("frozen");

      const { overCapacity } = await back.run({ actorId: STAFF, enrollmentId, classGroupModuleId: LATER_RUN_2, allowOverCapacity: true });
      expect(overCapacity).toBe(true);
      expect(await seatsTaken(tx, LATER)).toEqual({ taken: 1, over: 1 });
    });
  });

  it("re-engages a freeze at its latest milestone, once", async () => {
    await rolledBack(async (tx, { enrollmentId, repository }) => {
      const { freezeId } = await freezeOf(repository).run({ actorId: STAFF, enrollmentId, reason: "x" });
      // Four months ago: the 3-month e-mail is the one due; the 1-month one was missed and is not sent late.
      const old = await tx
        .insert(enrollmentFreezes)
        .values({
          enrollmentId,
          classGroupId: GROUP,
          classGroupModuleId: RUN_2,
          module: 2,
          attempt: 1,
          frozenBy: STAFF,
          createdAt: sql`now() - interval '4 months'` as unknown as Date,
        })
        .returning({ id: enrollmentFreezes.id });
      void freezeId;
      const send = new SendFreezeReengagementUseCase(new DrizzleFreezeReengagementRepository(tx as unknown as Db));

      expect(await send.run({ locale: "es-PE" })).toEqual({ queued: 1 });
      expect(await send.run({ locale: "es-PE" })).toEqual({ queued: 0 });
      const rows = await tx
        .select({ key: outbox.dedupeKey })
        .from(outbox)
        .where(eq(outbox.templateKey, "enrollment_freeze_reengagement"));
      expect(rows).toEqual([{ key: `enrollment_freeze_reengagement:${old[0]!.id}:3:student` }]);
    });
  });
});
