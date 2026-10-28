import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, planPrices, plans, students } from "@ooc/db";
import {
  CatalogClassGroupNotFoundError,
  GetOwnClassGroupUseCase,
  GetTeachingSummaryUseCase,
  ListOwnClassGroupStudentsUseCase,
  ListOwnClassGroupsUseCase,
  Teacher,
  type CreateTeacherDTO,
} from "@ooc/domain";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ClassGroupRosterQuery } from "@/infra/persistence/catalog/ClassGroupRosterQuery.js";
import { DrizzleTeacherRepository } from "@/infra/persistence/teacher/DrizzleTeacherRepository.js";
import { DrizzleTeachingReader } from "./DrizzleTeachingReader.js";

/**
 * The docente portal's acceptance gate (OOC-82, Sessão 36): a teacher sees
 * exactly their own class groups — read through the real usecases over the
 * real adapters, against a real, migrated Postgres. Teacher A asking for
 * teacher B's class group or roster, by putting B's id where A's would go,
 * gets the same not-found as an id that does not exist.
 *
 * Every test runs inside a transaction that is always rolled back: students
 * and plan_prices rows cannot be deleted afterwards (migrations 0011, 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the docente portal scope against a real, migrated Postgres.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

const DAY = 24 * 60 * 60 * 1000;
const PERIOD = "018f2b5c-8200-7000-8000-000000000001";
const COURSE = "018f2b5c-8200-7000-8000-000000000002";
const PLAN = "018f2b5c-8200-7000-8000-000000000003";
const PRICE = "018f2b5c-8200-7000-8000-000000000004";
const A_RUNNING = "018f2b5c-8200-7000-8000-000000000011";
const A_FINISHED = "018f2b5c-8200-7000-8000-000000000012";
const A_CLOSED = "018f2b5c-8200-7000-8000-000000000013";
const A_DRAFT = "018f2b5c-8200-7000-8000-000000000014";
const A_RETIRED = "018f2b5c-8200-7000-8000-000000000015";
const B_RUNNING = "018f2b5c-8200-7000-8000-000000000016";
const NOBODYS = "018f2b5c-8200-7000-8000-000000000017";
const UNKNOWN = "018f2b5c-8200-7000-8000-0000000000ff";

const A_ACCOUNT = "usr_ooc82_a";
const B_ACCOUNT = "usr_ooc82_b";
const NO_FILE_ACCOUNT = "usr_ooc82_nofile";

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Docente",
  nationalIdType: "DNI",
  nationalId: "82234567",
  email: "ana.ooc82@example.com",
  phone: "+51900000082",
  nationality: "PE",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Prueba 82",
  languages: ["Lengua de prueba"],
  availability: [],
};
const BETO: CreateTeacherDTO = { ...ANA, firstName: "Beto", nationalId: "82234568", email: "beto.ooc82@example.com" };

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});
afterAll(async () => {
  await pool.end();
});

interface Portal {
  list: ListOwnClassGroupsUseCase;
  get: GetOwnClassGroupUseCase;
  students: ListOwnClassGroupStudentsUseCase;
  summary: GetTeachingSummaryUseCase;
}

function portal(tx: Db): Portal {
  const teachers = new DrizzleTeacherRepository(tx);
  const reader = new DrizzleTeachingReader(tx, new ClassGroupRosterQuery(tx));
  const list = new ListOwnClassGroupsUseCase(teachers, reader);
  const get = new GetOwnClassGroupUseCase(teachers, reader);
  return {
    list,
    get,
    students: new ListOwnClassGroupStudentsUseCase(get, reader),
    summary: new GetTeachingSummaryUseCase(list, reader),
  };
}

function groupRow(
  id: string,
  code: string,
  teacherId: string | null,
  status: string,
  retired = false,
  module: number | null = null,
) {
  const now = Date.now();
  const dated = status !== "draft";
  return {
    id,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    slots: [{ weekday: "tue" as const, startTime: "19:00", endTime: "20:30" }],
    code,
    teacherId,
    teacherName: "",
    classroomUrl: `https://classroom.google.com/c/${code}`,
    module,
    startsOn: dated ? new Date(now - 7 * DAY) : null,
    endsOn: dated ? new Date(now + 40 * DAY) : null,
    capacity: 20,
    seatsTaken: 2,
    status,
    deletedAt: retired ? new Date(now) : null,
  };
}

function studentRow(id: string, firstName: string, lastName: string, nationalId: string) {
  return {
    id,
    firstName,
    lastName,
    nationalIdType: "DNI",
    nationalId,
    email: `${nationalId.toLowerCase()}@gmail.com`,
    phone: "+51900000000",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  };
}

async function seeded(fn: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (raw: Tx) => {
      const tx = raw as unknown as Db;
      const now = Date.now();
      await tx.execute(
        sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
            values (${A_ACCOUNT}, 'Ana Docente', 'ooc82.a@test.local', true, 'teacher', now(), now()),
                   (${B_ACCOUNT}, 'Beto Docente', 'ooc82.b@test.local', true, 'teacher', now(), now()),
                   (${NO_FILE_ACCOUNT}, 'Sin Ficha', 'ooc82.nofile@test.local', true, 'teacher', now(), now())`,
      );
      const teachers = new DrizzleTeacherRepository(tx);
      const ana = await teachers.create(Teacher.create(ANA));
      const beto = await teachers.create(Teacher.create(BETO));
      await teachers.linkAccount(ana.id, A_ACCOUNT);
      await teachers.linkAccount(beto.id, B_ACCOUNT);

      await tx.insert(academicPeriods).values({
        id: PERIOD,
        name: "Ciclo (teaching integration)",
        startsOn: new Date(now - 30 * DAY),
        endsOn: new Date(now + 60 * DAY),
      });
      await tx.insert(courses).values({
        id: COURSE,
        name: "Curso (teaching integration)",
        language: "Lengua de prueba",
        minAge: 12,
        modules: 2,
        moduleMaterials: ["https://drive.google.com/ooc100-m1", "https://drive.google.com/ooc100-m2"],
      });
      await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete (teaching integration)" });
      await tx.insert(planPrices).values({ id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) });
      await tx
        .insert(classGroups)
        .values([
          groupRow(A_RUNNING, "OOC82-A1", ana.id, "in_progress", false, 2),
          groupRow(A_FINISHED, "OOC82-A2", ana.id, "finished"),
          groupRow(A_CLOSED, "OOC82-A3", ana.id, "closed"),
          groupRow(A_DRAFT, "OOC82-A4", ana.id, "draft"),
          groupRow(A_RETIRED, "OOC82-A5", ana.id, "enrolling", true),
          groupRow(B_RUNNING, "OOC82-B1", beto.id, "in_progress"),
          groupRow(NOBODYS, "OOC82-N1", null, "enrolling"),
        ]);

      const ZAPATA = "018f2b5c-8200-7000-8000-000000000021";
      const RESERVED = "018f2b5c-8200-7000-8000-000000000022";
      const BETOS = "018f2b5c-8200-7000-8000-000000000023";
      await tx
        .insert(students)
        .values([
          studentRow(ZAPATA, "Lucía", "Zapata", "OOC82-STUDENT-1"),
          studentRow(RESERVED, "Rosa", "Reservada", "OOC82-STUDENT-2"),
          studentRow(BETOS, "Marco", "DeBeto", "OOC82-STUDENT-3"),
        ]);
      await tx.insert(enrollments).values([
        { studentId: ZAPATA, classGroupId: A_RUNNING, planPriceId: PRICE, seatStatus: "confirmed" },
        { studentId: RESERVED, classGroupId: A_RUNNING, planPriceId: PRICE, seatStatus: "reserved" },
        { studentId: BETOS, classGroupId: B_RUNNING, planPriceId: PRICE, seatStatus: "confirmed" },
      ]);

      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

describe("docente portal scope (OOC-82)", () => {
  it("lists exactly the teacher's own class groups still in the portal", async () => {
    await seeded(async (tx) => {
      const groups = await portal(tx).list.run({ userId: A_ACCOUNT });

      // Closed, draft and retired are out; B's and the unallocated one were never A's.
      expect(groups.map((group) => group.id).sort()).toEqual([A_RUNNING, A_FINISHED].sort());
      expect(groups.every((group) => group.courseName === "Curso (teaching integration)")).toBe(true);
    });
  });

  it("answers not-found when teacher A asks for teacher B's class group by its id", async () => {
    await seeded(async (tx) => {
      const { get } = portal(tx);

      await expect(get.run({ userId: A_ACCOUNT, classGroupId: B_RUNNING })).rejects.toBeInstanceOf(CatalogClassGroupNotFoundError);
      // The same answer as an id that does not exist — nothing tells the two apart.
      await expect(get.run({ userId: A_ACCOUNT, classGroupId: UNKNOWN })).rejects.toBeInstanceOf(CatalogClassGroupNotFoundError);
      await expect(get.run({ userId: B_ACCOUNT, classGroupId: B_RUNNING })).resolves.toMatchObject({ id: B_RUNNING });
    });
  });

  it("reads the own class group's Classroom link (OOC-98)", async () => {
    await seeded(async (tx) => {
      const { get, list } = portal(tx);

      await expect(get.run({ userId: A_ACCOUNT, classGroupId: A_RUNNING })).resolves.toMatchObject({
        classroomUrl: "https://classroom.google.com/c/OOC82-A1",
      });
      const listed = await list.run({ userId: A_ACCOUNT });
      expect(listed.find((group) => group.id === A_RUNNING)?.classroomUrl).toBe("https://classroom.google.com/c/OOC82-A1");
    });
  });

  it("reads the material of the module the class group teaches (OOC-100)", async () => {
    await seeded(async (tx) => {
      const { get } = portal(tx);

      await expect(get.run({ userId: A_ACCOUNT, classGroupId: A_RUNNING })).resolves.toMatchObject({
        module: 2,
        moduleMaterialUrl: "https://drive.google.com/ooc100-m2",
      });
      // No module set: nothing to open, not the first module's material.
      await expect(get.run({ userId: A_ACCOUNT, classGroupId: A_FINISHED })).resolves.toMatchObject({
        module: null,
        moduleMaterialUrl: null,
      });
    });
  });

  it("answers not-found when teacher A asks for teacher B's students, without reading them", async () => {
    await seeded(async (tx) => {
      const { students: roster } = portal(tx);

      await expect(roster.run({ userId: A_ACCOUNT, classGroupId: B_RUNNING })).rejects.toBeInstanceOf(
        CatalogClassGroupNotFoundError,
      );
      await expect(roster.run({ userId: B_ACCOUNT, classGroupId: B_RUNNING })).resolves.toHaveLength(1);
    });
  });

  it("reads the own roster as names only, confirmed seats only", async () => {
    await seeded(async (tx) => {
      const roster = await portal(tx).students.run({ userId: A_ACCOUNT, classGroupId: A_RUNNING });

      expect(roster).toHaveLength(1);
      expect(Object.keys(roster[0]!).sort()).toEqual(["enrollmentId", "firstName", "lastName"]);
      expect(roster[0]).toMatchObject({ firstName: "Lucía", lastName: "Zapata" });
    });
  });

  it("keeps a closed, draft or retired class group out by URL too", async () => {
    await seeded(async (tx) => {
      const { get } = portal(tx);
      for (const id of [A_CLOSED, A_DRAFT, A_RETIRED]) {
        await expect(get.run({ userId: A_ACCOUNT, classGroupId: id })).rejects.toBeInstanceOf(CatalogClassGroupNotFoundError);
      }
    });
  });

  it("gives a teacher account linked to no file nothing — not even the unallocated class group", async () => {
    await seeded(async (tx) => {
      const { list, get } = portal(tx);

      await expect(list.run({ userId: NO_FILE_ACCOUNT })).resolves.toEqual([]);
      await expect(get.run({ userId: NO_FILE_ACCOUNT, classGroupId: NOBODYS })).rejects.toBeInstanceOf(
        CatalogClassGroupNotFoundError,
      );
    });
  });

  it("counts the home's figures over the same scope", async () => {
    await seeded(async (tx) => {
      await expect(portal(tx).summary.run({ userId: A_ACCOUNT })).resolves.toEqual({ teaching: 1, inPortal: 2, students: 1 });
      await expect(portal(tx).summary.run({ userId: NO_FILE_ACCOUNT })).resolves.toEqual({
        teaching: 0,
        inPortal: 0,
        students: 0,
      });
    });
  });
});
