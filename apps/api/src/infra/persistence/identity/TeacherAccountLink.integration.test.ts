import * as schema from "@ooc/db";
import { Teacher, type CreateTeacherDTO } from "@ooc/domain";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { seedLanguages } from "@/tests/fixtures/languages.js";
import { DrizzleStaffInviteRepository } from "@/infra/identity/DrizzleStaffInviteRepository.js";
import { DrizzleTeacherRepository } from "@/infra/persistence/teacher/DrizzleTeacherRepository.js";
import { ListInvitableTeachersQuery } from "./ListInvitableTeachersQuery.js";
import { ListStaffQuery } from "./ListStaffQuery.js";

/**
 * The account ↔ teacher file link read back from a real, migrated Postgres
 * (OOC-79): the invite carries the file, Equipe shows which file each teacher
 * account and invite belongs to, and the invite form only offers files that
 * can still receive an account. Every test runs inside a transaction that is
 * always rolled back.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the teacher account link against a real, migrated Postgres.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

const ADMIN = "usr_ooc79_admin";
const ANA_ACCOUNT = "usr_ooc79_ana";

const ANA: CreateTeacherDTO = {
  firstName: "Ana",
  lastName: "Vínculo",
  nationalIdType: "DNI",
  nationalId: "93234567",
  email: "ana.vinculo@example.com",
  phone: "+51900000001",
  nationality: "IT",
  country: "PE",
  region: "Lima",
  city: "Lima",
  addressLine: "Av. Prueba 123",
  languages: ["Italiano (prueba)"],
  availability: [],
};

const LUIS: CreateTeacherDTO = { ...ANA, firstName: "Luis", nationalId: "93234568", email: "luis.vinculo@example.com" };
const RITA: CreateTeacherDTO = { ...ANA, firstName: "Rita", nationalId: "93234569", email: "rita.vinculo@example.com" };
const EVA: CreateTeacherDTO = { ...ANA, firstName: "Eva", nationalId: "93234570", email: "eva.vinculo@example.com" };

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
      await seedLanguages(tx, ["Italiano (prueba)"]);
      await tx.execute(
        sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
            values (${ADMIN}, 'Admin Vínculo', 'ooc79.admin@test.local', true, 'admin', now(), now()),
                   (${ANA_ACCOUNT}, 'Ana Vínculo', 'ooc79.ana@test.local', true, 'teacher', now(), now())`,
      );
      await fn(tx as unknown as Db);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

function teacherInvite(teacherId: string, email: string) {
  return {
    email,
    firstName: "Luis",
    lastName: "Vínculo",
    role: "teacher" as const,
    token: `tok_ooc79_${email}`,
    invitedBy: ADMIN,
    teacherId,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

describe("teacher account link", () => {
  it("shows the file behind each teacher account and invite on the team list", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const invites = new DrizzleStaffInviteRepository(tx);
      const ana = await teachers.create(Teacher.create(ANA));
      const luis = await teachers.create(Teacher.create(LUIS));
      await teachers.linkAccount(ana.id, ANA_ACCOUNT);
      const invite = await invites.create(teacherInvite(luis.id, "luis.ooc79@test.local"));

      const rows = await new ListStaffQuery(tx).run();

      expect(rows.find((row) => row.id === ANA_ACCOUNT)?.teacherId).toBe(ana.id);
      expect(rows.find((row) => row.id === invite.id)?.teacherId).toBe(luis.id);
      expect(rows.find((row) => row.id === ADMIN)?.teacherId).toBeNull();
      expect((await invites.findPendingByTeacherId(luis.id))?.id).toBe(invite.id);
    });
  });

  it("offers only active files with no account and no open invite", async () => {
    await rolledBack(async (tx) => {
      const teachers = new DrizzleTeacherRepository(tx);
      const invites = new DrizzleStaffInviteRepository(tx);
      const ana = await teachers.create(Teacher.create(ANA));
      const luis = await teachers.create(Teacher.create(LUIS));
      const rita = await teachers.create(Teacher.create(RITA));
      const eva = Teacher.create(EVA);
      eva.leaveRoster();
      await teachers.create(eva);
      await teachers.linkAccount(ana.id, ANA_ACCOUNT);
      await invites.create(teacherInvite(luis.id, "luis.ooc79@test.local"));

      const ids = (await new ListInvitableTeachersQuery(tx).run()).map((teacher) => teacher.id);

      expect(ids).toContain(rita.id);
      expect(ids).not.toContain(ana.id);
      expect(ids).not.toContain(luis.id);
      expect(ids).not.toContain(eva.id);
    });
  });
});
