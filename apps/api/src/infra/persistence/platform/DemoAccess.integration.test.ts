import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, enrollments, planPrices, plans, students, teachers } from "@ooc/db";
import { DemoCourseUnavailableError } from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ClassGroupRosterQuery } from "@/infra/persistence/catalog/ClassGroupRosterQuery.js";
import { GetPublicCatalogQuery } from "@/infra/persistence/catalog/GetPublicCatalogQuery.js";
import { ListClassGroupsQuery } from "@/infra/persistence/catalog/ListClassGroupsQuery.js";
import { ListEnrollmentsQuery } from "@/infra/persistence/enrollment/ListEnrollmentsQuery.js";
import { ListStaffQuery } from "@/infra/persistence/identity/ListStaffQuery.js";
import { ListStudentsQuery } from "@/infra/persistence/student/ListStudentsQuery.js";
import { DrizzleTeachingReader } from "@/infra/persistence/teaching/DrizzleTeachingReader.js";
import { DrizzleDemoAccessRepository } from "./DrizzleDemoAccessRepository.js";

/**
 * The owners' demo accesses (28/11/2026), against the migrated schema: what a
 * kit writes, that every staff list leaves it out while the portals still see
 * it, and what revoking closes. Every test runs inside a transaction that
 * never commits (plan_prices cannot be deleted afterwards, migration 0017).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the demo accesses against a real, migrated Postgres.");
}

const DAY = 24 * 60 * 60 * 1000;
const OWNER = "usr_demo_access_integration";
const PERIOD = "018f2b5c-5900-7000-8000-00000000d001";
const COURSE = "018f2b5c-5900-7000-8000-00000000d002";
const PLAN = "018f2b5c-5900-7000-8000-00000000d003";
const PRICE = "018f2b5c-5900-7000-8000-00000000d004";
const MONTHLY_COURSE = "018f2b5c-5900-7000-8000-00000000d005";
const MONTHLY_PLAN = "018f2b5c-5900-7000-8000-00000000d006";
const MONTHLY_PRICE = "018f2b5c-5900-7000-8000-00000000d007";

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
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${OWNER}, 'Owner', 'owner.demo@nrlabsdigital.com', true, 'master', now(), now())`,
  );
  // Started a minute ago: the most recent period, the one a kit lands in.
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (demo integration)",
    startsOn: new Date(now - 60 * 1000),
    endsOn: new Date(now + 120 * DAY),
  });
  await tx.insert(courses).values([
    { id: COURSE, name: "Curso (demo integration)", language: "Lengua demo", minAge: 12 },
    { id: MONTHLY_COURSE, name: "Mensual (demo integration)", language: "Lengua demo", minAge: 12 },
  ]);
  await tx.insert(plans).values([
    { id: PLAN, courseId: COURSE, name: "Paquete (demo integration)" },
    { id: MONTHLY_PLAN, courseId: MONTHLY_COURSE, name: "Mensual (demo integration)", billing: "monthly" },
  ]);
  await tx.insert(planPrices).values([
    { id: PRICE, planId: PLAN, amountCents: 9900, validFrom: new Date(now - DAY) },
    { id: MONTHLY_PRICE, planId: MONTHLY_PLAN, amountCents: 4900, validFrom: new Date(now - DAY) },
  ]);
}

const KIT = { courseId: COURSE, firstName: "Rick", lastName: "Demo", actorId: OWNER, at: new Date() };

describe("demo accesses", () => {
  it("a student's kit is a confirmed seat in a demo class group in progress, with no payment", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const repo = new DrizzleDemoAccessRepository(tx);
      const kit = await repo.createStudentKit({ ...KIT, email: "rick.demo.ooc@gmail.com" });

      const [group] = await tx.select().from(classGroups).where(eq(classGroups.id, kit.classGroupId));
      expect(group).toMatchObject({ isDemo: true, status: "in_progress", academicPeriodId: PERIOD, seatsTaken: 1 });
      expect(group!.enrollmentClosesAt!.getTime()).toBeLessThanOrEqual(Date.now());

      const [student] = await tx.select().from(students).where(eq(students.id, kit.ownerId));
      expect(student).toMatchObject({ isDemo: true, email: "rick.demo.ooc@gmail.com" });

      const seats = await tx.select().from(enrollments).where(eq(enrollments.studentId, kit.ownerId));
      expect(seats).toHaveLength(1);
      expect(seats[0]).toMatchObject({ seatStatus: "confirmed", planPriceId: PRICE });
      const paid = await tx.execute(sql`select count(*)::int as n from "payment_coverage" where "enrollment_id" = ${seats[0]!.id}`);
      expect(paid.rows[0]).toEqual({ n: 0 });

      expect(await repo.emailInUse("rick.demo.ooc@gmail.com")).toBe(true);
    });
  });

  it("no staff list sees it, and nothing sells it", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const repo = new DrizzleDemoAccessRepository(tx);
      const kit = await repo.createStudentKit({ ...KIT, email: "rick.demo.ooc@gmail.com" });

      const directory = await new ListStudentsQuery(tx).directory({ status: "all" } as never);
      expect(directory.items.map((row) => row.id)).not.toContain(kit.ownerId);
      expect((await new ListStudentsQuery(tx).search("Rick")).map((row) => row.id)).not.toContain(kit.ownerId);

      const ledger = await new ListEnrollmentsQuery(tx).run({});
      expect(ledger.items.map((row) => row.studentId)).not.toContain(kit.ownerId);

      const groups = await new ListClassGroupsQuery(tx).run({});
      expect(groups.map((row) => row.id)).not.toContain(kit.classGroupId);

      const catalog = await new GetPublicCatalogQuery(tx).run();
      expect(catalog.classGroups.map((row) => row.id)).not.toContain(kit.classGroupId);
    });
  });

  it("a teacher's kit runs the demo class group with a fictitious roster nobody can e-mail", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const repo = new DrizzleDemoAccessRepository(tx);
      const kit = await repo.createTeacherKit({ ...KIT, email: "rick@onlyonecoin.edu.pe" });

      const [teacher] = await tx.select().from(teachers).where(eq(teachers.id, kit.ownerId));
      expect(teacher).toMatchObject({ isDemo: true, status: "active", nationalId: null });

      const roster = await tx
        .select({ email: students.email, isDemo: students.isDemo })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(eq(enrollments.classGroupId, kit.classGroupId));
      expect(roster).toHaveLength(3);
      for (const row of roster) {
        expect(row.isDemo).toBe(true);
        expect(row.email).toMatch(/@demo\.invalid$/);
      }

      // The teacher portal sees it; the team's roster and Team do not.
      const reader = new DrizzleTeachingReader(tx, new ClassGroupRosterQuery(tx));
      expect((await reader.listClassGroupsOf(kit.ownerId)).map((group) => group.classGroupId)).toContain(kit.classGroupId);
      await tx.execute(sql`
        insert into "staff_invites" ("email", "first_name", "last_name", "role", "token", "invited_by", "teacher_id", "expires_at")
        values ('rick@onlyonecoin.edu.pe', 'Rick', 'Demo', 'teacher', 'demo-token', ${OWNER}, ${kit.ownerId}, now() + interval '7 days')
      `);
      const team = await new ListStaffQuery(tx).run();
      expect(team.map((row) => row.email)).not.toContain("rick@onlyonecoin.edu.pe");
    });
  });

  it("refuses a course with no one-off plan priced", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const repo = new DrizzleDemoAccessRepository(tx);
      await expect(repo.createStudentKit({ ...KIT, courseId: MONTHLY_COURSE, email: "rick.demo.ooc@gmail.com" })).rejects.toBeInstanceOf(
        DemoCourseUnavailableError,
      );
      const options = await repo.courseOptions();
      expect(options.map((course) => course.id)).toContain(COURSE);
      expect(options.map((course) => course.id)).not.toContain(MONTHLY_COURSE);
    });
  });

  it("revoking closes the account, the invite and the class group, once", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);
      const repo = new DrizzleDemoAccessRepository(tx);
      const kit = await repo.createTeacherKit({ ...KIT, email: "rick@onlyonecoin.edu.pe" });
      await tx.execute(sql`
        insert into "staff_invites" ("email", "first_name", "last_name", "role", "token", "invited_by", "teacher_id", "expires_at")
        values ('rick@onlyonecoin.edu.pe', 'Rick', 'Demo', 'teacher', 'demo-token', ${OWNER}, ${kit.ownerId}, now() + interval '7 days')
      `);

      expect(await repo.revoke(kit.accessId, OWNER, new Date())).toEqual({ kind: "teacher", classGroupId: kit.classGroupId });
      expect(await repo.revoke(kit.accessId, OWNER, new Date())).toBeNull();

      const [group] = await tx.select().from(classGroups).where(eq(classGroups.id, kit.classGroupId));
      expect(group!.deletedAt).not.toBeNull();
      const [teacher] = await tx.select().from(teachers).where(eq(teachers.id, kit.ownerId));
      expect(teacher!.status).toBe("inactive");
      const invite = await tx.execute(sql`select "status" from "staff_invites" where "teacher_id" = ${kit.ownerId}`);
      expect(invite.rows[0]).toEqual({ status: "cancelled" });
      // The address is free again for a real account.
      expect(await repo.emailInUse("rick@onlyonecoin.edu.pe")).toBe(false);

      const [listed] = await repo.list();
      expect(listed).toMatchObject({ id: kit.accessId, kind: "teacher", activated: false });
      expect(listed!.revokedAt).not.toBeNull();
    });
  });
});
