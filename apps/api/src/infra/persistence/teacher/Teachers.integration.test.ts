import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, teacherContracts } from "@ooc/db";
import { Teacher, TeacherAlreadyRegisteredError, type CreateTeacherDTO } from "@ooc/domain";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ListClassGroupsQuery } from "@/infra/persistence/catalog/ListClassGroupsQuery.js";
import { DrizzleTeacherRepository } from "./DrizzleTeacherRepository.js";
import { GetTeacherQuery } from "./GetTeacherQuery.js";
import { ListTeachersQuery } from "./ListTeachersQuery.js";

/**
 * The teacher file against a real, migrated Postgres (OOC-78): the aggregate
 * round-trips through its three tables, the roster filters run in SQL, and the
 * file reads the class groups allocated through `class_groups.teacher_id`.
 * `teachers` is under the delete lock (0025), so every test runs inside a
 * transaction that is always rolled back.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the teacher persistence against a real, migrated Postgres.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

const PERIOD = "018f2b5c-9000-7000-8000-000000000001";
const COURSE = "018f2b5c-9000-7000-8000-000000000002";
const UPLOADER = "usr_teacher_integration";

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Docente",
  nationalIdType: "DNI",
  nationalId: "91234567",
  email: "ana.docente@example.com",
  phone: "+51900000001",
  nationality: "IT",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Prueba 123",
  languages: ["Italiano (prueba)"],
  availability: [
    { weekday: "tue", startTime: "19:00", endTime: "21:00" },
    { weekday: "mon", startTime: "09:00", endTime: "12:00" },
  ],
};

const LUIS: CreateTeacherDTO = {
  ...ANA,
  firstName: "Luis",
  lastName: "Docente",
  nationalId: "91234568",
  email: "luis.docente@example.com",
  languages: ["Inglés (prueba)"],
  availability: [],
};

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

async function rolledBack(fn: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx: Tx) => {
      await seedCatalog(tx);
      // A transaction handle answers the same calls as the pool; the
      // repository's own transaction becomes a savepoint inside it.
      await fn(tx as unknown as Db);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function seedCatalog(tx: Tx): Promise<void> {
  // teacher_contracts.uploaded_by is a foreign key to Better Auth's "user",
  // which is not in the Drizzle schema.
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${UPLOADER}, 'Coordinación', 'teacher.integration@test.local', true, 'admin', now(), now())`,
  );
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (teacher integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (teacher integration)", language: "Prueba", minAge: 12 });
}

let groupSequence = 0;

async function allocate(tx: Db, teacherId: string, status: string, seatsTaken: number): Promise<string> {
  groupSequence += 1;
  const [row] = await tx
    .insert(classGroups)
    .values({
      courseId: COURSE,
      academicPeriodId: PERIOD,
      code: `TCH-${groupSequence}`,
      schedule: "Mar 19:00",
      startsOn: new Date("2026-03-02T00:00:00.000Z"),
      endsOn: new Date("2026-06-30T00:00:00.000Z"),
      capacity: 30,
      seatsTaken,
      status,
      teacherId,
    })
    .returning({ id: classGroups.id });
  return row!.id;
}

async function fileContract(tx: Db, teacherId: string, endsOn: Date, filedAt = new Date()): Promise<void> {
  await tx.insert(teacherContracts).values({
    teacherId,
    objectKey: `contracts/${teacherId}/${endsOn.getTime()}`,
    fileName: "contrato.pdf",
    fileSizeBytes: 1024,
    startsOn: new Date("2026-01-01T00:00:00.000Z"),
    endsOn,
    uploadedBy: UPLOADER,
    createdAt: filedAt,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("DrizzleTeacherRepository", () => {
  it("round-trips the aggregate, languages and week included", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const created = await teachers.create(Teacher.create(ANA));

      const read = await teachers.findById(created.id);
      expect(read?.languages).toEqual(["Italiano (prueba)"]);
      // Postgres `time` comes back as HH:mm, ordered by day then start.
      expect(read?.availability).toEqual([
        { weekday: "mon", startTime: "09:00", endTime: "12:00" },
        { weekday: "tue", startTime: "19:00", endTime: "21:00" },
      ]);

      const byDocument = await teachers.findByNationalId({ nationalIdType: "DNI", nationalId: "91234567" });
      expect(byDocument?.id).toBe(created.id);
    });
  });

  it("rewrites the lists as a whole on update", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const created = await teachers.create(Teacher.create(ANA));

      created.rewrite({ ...ANA, languages: ["Francés (prueba)"] });
      created.replaceAvailability([{ weekday: "fri", startTime: "18:00", endTime: "20:00" }]);
      created.leaveRoster();
      await teachers.update(created);

      const read = await teachers.findById(created.id);
      expect(read?.languages).toEqual(["Francés (prueba)"]);
      expect(read?.availability).toEqual([{ weekday: "fri", startTime: "18:00", endTime: "20:00" }]);
      expect(read?.status).toBe("inactive");
    });
  });

  it("turns the unique index refusing a document into the domain error", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      await teachers.create(Teacher.create(ANA));

      await expect(teachers.create(Teacher.create({ ...LUIS, nationalId: ANA.nationalId }))).rejects.toBeInstanceOf(
        TeacherAlreadyRegisteredError,
      );
    });
  });

  it("counts only class groups still enrolling or running", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const ana = await teachers.create(Teacher.create(ANA));
      await allocate(tx, ana.id, "enrolling", 3);
      await allocate(tx, ana.id, "in_progress", 5);
      await allocate(tx, ana.id, "finished", 7);

      expect(await teachers.countRunningClassGroups(ana.id)).toBe(2);
    });
  });
});

describe("ListTeachersQuery", () => {
  it("cuts the roster by tab and counts each chip over the search", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const list = new ListTeachersQuery(tx);

      const ana = await teachers.create(Teacher.create(ANA));
      const luis = await teachers.create(Teacher.create(LUIS));
      const gone = Teacher.create({ ...LUIS, firstName: "Rita", nationalId: "91234569" });
      gone.leaveRoster();
      await teachers.create(gone);

      await allocate(tx, ana.id, "in_progress", 12);
      // Ana's contract runs another year; Luis has none on file.
      await fileContract(tx, ana.id, new Date(Date.now() + 365 * DAY_MS));

      const roster = await list.directory({ q: "Docente" });
      expect(roster.items.map((row) => row.firstName)).toEqual(["Ana", "Luis"]);
      expect(roster.counts).toEqual({ active: 2, inactive: 1, free: 1, contract: 1 });

      const anaRow = roster.items.find((row) => row.id === ana.id)!;
      expect(anaRow.activeClassGroups).toBe(1);
      expect(anaRow.studentCount).toBe(12);
      expect(anaRow.contract?.fileName).toBe("contrato.pdf");
      expect(anaRow.contractDaysLeft).toBeGreaterThan(300);

      const luisRow = roster.items.find((row) => row.id === luis.id)!;
      expect(luisRow.contract).toBeNull();
      expect(luisRow.contractDaysLeft).toBeNull();

      const free = await list.directory({ q: "Docente", free: true });
      expect(free.items.map((row) => row.id)).toEqual([luis.id]);

      const chasing = await list.directory({ q: "Docente", contract: true });
      expect(chasing.items.map((row) => row.id)).toEqual([luis.id]);

      const italian = await list.directory({ q: "Docente", language: "Italiano (prueba)" });
      expect(italian.items.map((row) => row.id)).toEqual([ana.id]);

      const inactive = await list.directory({ q: "Docente", status: "inactive" });
      expect(inactive.items.map((row) => row.firstName)).toEqual(["Rita"]);
    });
  });

  it("flags a contract inside the alert window and reads the latest filing", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const list = new ListTeachersQuery(tx);
      const ana = await teachers.create(Teacher.create(ANA));

      // Filed later, the second is the one in force — ten days from its end.
      // `now()` stands still inside a transaction, so the filing dates are given.
      await fileContract(tx, ana.id, new Date(Date.now() + 365 * DAY_MS), new Date(Date.now() - 2 * DAY_MS));
      await fileContract(tx, ana.id, new Date(Date.now() + 10 * DAY_MS), new Date(Date.now() - DAY_MS));

      const row = await list.byId(ana.id);
      expect(row?.contractDaysLeft).toBe(10);

      const chasing = await list.directory({ q: "Docente", contract: true });
      expect(chasing.items.map((item) => item.id)).toEqual([ana.id]);
    });
  });
});

describe("GetTeacherQuery", () => {
  it("reads the week and the class groups allocated to the teacher", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const list = new ListTeachersQuery(tx);
      const get = new GetTeacherQuery(tx, list, new ListClassGroupsQuery(tx));

      const ana = await teachers.create(Teacher.create(ANA));
      const luis = await teachers.create(Teacher.create(LUIS));
      const group = await allocate(tx, ana.id, "enrolling", 4);
      await allocate(tx, luis.id, "enrolling", 4);

      const file = await get.run(ana.id);
      expect(file?.availability).toHaveLength(2);
      expect(file?.classGroups.map((item) => item.id)).toEqual([group]);

      expect(await get.run("018f2b5c-9000-7000-8000-00000000ffff")).toBeNull();
    });
  });
});
