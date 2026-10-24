import * as schema from "@ooc/db";
import { academicPeriods, auditLog, classGroups, courses, planPrices, plans, students } from "@ooc/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_TARGET, AuditLogQuery, type AuditLogRow } from "./AuditLogQuery.js";

/**
 * OOC-122: the general audit log filters in Postgres — period as Lima
 * calendar days, author, action (one screen key, every stored action behind
 * it) and entity (retire/restore by the kind they name) — pages by cursor,
 * and names the record an entry is about when it still exists.
 *
 * `audit_log` is append-only (migration 0011): every test runs in a
 * transaction that is always rolled back, and every read is scoped to this
 * suite's own author, so other rows never leak in.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises AuditLogQuery against a real, migrated Postgres.");
}

const ACTOR = "audit-integration-actor";
const OTHER_ACTOR = "audit-integration-other";

const PERIOD = "018f2b5c-7100-7000-8000-000000000001";
const COURSE = "018f2b5c-7100-7000-8000-000000000002";
const PLAN = "018f2b5c-7100-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-7100-7000-8000-000000000004";
const GROUP = "018f2b5c-7100-7000-8000-000000000005";
const STUDENT = "018f2b5c-7100-7000-8000-000000000006";
/** A student id no row carries — the subject is gone. */
const GONE = "018f2b5c-7100-7000-8000-0000000000ff";

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

async function seedCatalog(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo (audit integration)",
    startsOn: new Date("2099-03-01T00:00:00.000Z"),
    endsOn: new Date("2099-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso de auditoría", language: "Prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 10000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    status: "enrolling",
    code: "AUD-01",
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2099-03-02T00:00:00.000Z"),
    endsOn: new Date("2099-06-30T00:00:00.000Z"),
    capacity: 20,
  });
  await tx.insert(students).values({
    id: STUDENT,
    firstName: "Rosa",
    lastName: "Auditada",
    nationalIdType: "DNI",
    nationalId: "AUDTEST1",
    email: "rosa.auditada@gmail.com",
    phone: "+51900000000",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  });
}

interface Entry {
  action: string;
  targetId: string;
  at: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
}

async function write(tx: Tx, entries: Entry[]): Promise<void> {
  await tx.insert(auditLog).values(
    entries.map((entry) => ({
      actorId: entry.actorId ?? ACTOR,
      action: entry.action,
      targetId: entry.targetId,
      metadata: entry.metadata ?? null,
      createdAt: new Date(entry.at),
    })),
  );
}

const actionsOf = (rows: AuditLogRow[]) => rows.map((row) => row.action);

describe("general audit log", () => {
  it("reads a period as Lima calendar days", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      await write(tx, [
        // 23:59 on 1 Jan in Lima (UTC−5) is already 2 Jan in UTC.
        { action: "student.registered", targetId: STUDENT, at: "2099-01-02T04:59:00.000Z" },
        // Midnight of 2 Jan in Lima.
        { action: "student.updated", targetId: STUDENT, at: "2099-01-02T05:00:00.000Z" },
        { action: "student.updated", targetId: STUDENT, at: "2098-12-31T12:00:00.000Z" },
      ]);

      const firstOfJanuary = await query.page({ actorId: ACTOR, from: "2099-01-01", to: "2099-01-01" });
      expect(actionsOf(firstOfJanuary.items)).toEqual(["student_registered"]);

      const fromSecond = await query.page({ actorId: ACTOR, from: "2099-01-02" });
      expect(actionsOf(fromSecond.items)).toEqual(["student_updated"]);
    });
  });

  it("filters by author and by one screen action across every stored action behind it", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      await write(tx, [
        {
          action: "platform_settings.passing_grade",
          targetId: "passing_grade",
          at: "2099-01-01T10:00:00.000Z",
          metadata: { from: 14, to: 13 },
        },
        { action: "platform_settings.review_window_days", targetId: "review_window_days", at: "2099-01-01T11:00:00.000Z" },
        { action: "payment.approved", targetId: GONE, at: "2099-01-01T12:00:00.000Z" },
        {
          action: "platform_settings.passing_grade",
          targetId: "passing_grade",
          at: "2099-01-01T13:00:00.000Z",
          actorId: OTHER_ACTOR,
        },
      ]);

      const settings = await query.page({ actorId: ACTOR, action: "platform_setting_updated" });
      expect(actionsOf(settings.items)).toEqual(["platform_setting_updated", "platform_setting_updated"]);
      // The setting is what changed — its name, never the from/to the entry keeps.
      expect(settings.items.map((row) => row.fields)).toEqual([["review_window_days"], ["passing_grade"]]);
      expect(JSON.stringify(settings.items)).not.toContain(":13");

      const other = await query.page({ actorId: OTHER_ACTOR });
      expect(other.items).toHaveLength(1);
    });
  });

  it("filters by entity, a retired entry by the kind it names", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      await seedCatalog(tx);
      await write(tx, [
        {
          action: "catalog.course.updated",
          targetId: COURSE,
          at: "2099-01-01T10:00:00.000Z",
          metadata: { fields: ["name", "minAge"] },
        },
        { action: "catalog.plan.renamed", targetId: PLAN, at: "2099-01-01T11:00:00.000Z", metadata: { from: "A", to: "B" } },
        {
          action: "catalog.retired",
          targetId: PLAN,
          at: "2099-01-01T12:00:00.000Z",
          metadata: { kind: "plan", liveEnrollments: 0 },
        },
        {
          action: "catalog.retired",
          targetId: GROUP,
          at: "2099-01-01T13:00:00.000Z",
          metadata: { kind: "class_group", liveEnrollments: 0 },
        },
        { action: "student.registered", targetId: STUDENT, at: "2099-01-01T14:00:00.000Z" },
      ]);

      const course = await query.page({ actorId: ACTOR, entity: "course" });
      expect(actionsOf(course.items)).toEqual(["catalog_retired", "plan_renamed", "course_updated"]);
      // A plan's entries are its course's: the subject is the course.
      for (const row of course.items) {
        expect(row.entity).toBe("course");
        expect(row.subject).toEqual({ entity: "course", id: COURSE, label: "Curso de auditoría" });
      }
      expect(course.items[2]?.fields).toEqual(["name", "min_age"]);

      const group = await query.page({ actorId: ACTOR, entity: "class_group" });
      expect(actionsOf(group.items)).toEqual(["catalog_retired"]);
      expect(group.items[0]?.subject).toEqual({ entity: "class_group", id: GROUP, label: "AUD-01" });
    });
  });

  it("names the record an entry is about, wherever the entry keeps its id", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      await seedCatalog(tx);
      await write(tx, [
        {
          action: "enrollment.created",
          targetId: "018f2b5c-7100-7000-8000-0000000000e1",
          at: "2099-01-01T10:00:00.000Z",
          metadata: { studentId: STUDENT },
        },
        {
          action: "catalog.waitlist.joined",
          targetId: "018f2b5c-7100-7000-8000-0000000000e2",
          at: "2099-01-01T11:00:00.000Z",
          metadata: { classGroupId: GROUP, studentId: STUDENT },
        },
        { action: "student.updated", targetId: GONE, at: "2099-01-01T12:00:00.000Z", metadata: { fields: ["email"] } },
        { action: "staff.invite_created", targetId: "invite-1", at: "2099-01-01T13:00:00.000Z", metadata: { email: "x@y.com" } },
        { action: "something.nobody_catalogued", targetId: "x", at: "2099-01-01T14:00:00.000Z" },
      ]);

      const page = await query.page({ actorId: ACTOR });
      const byAction = new Map(page.items.map((row) => [row.action, row]));

      expect(byAction.get("enrollment_created")?.subject).toEqual({ entity: "student", id: STUDENT, label: "Rosa Auditada" });
      expect(byAction.get("waitlist_joined")?.subject).toEqual({ entity: "class_group", id: GROUP, label: "AUD-01" });
      // A student that no longer exists: the entity is still named, nothing is linked.
      expect(byAction.get("student_updated")).toMatchObject({ entity: "student", subject: null, fields: ["email"] });
      expect(byAction.get("staff_invite_created")).toMatchObject({ entity: "staff", subject: null });
      // Never the stored code.
      expect(byAction.get("unknown")).toMatchObject({ entity: null, subject: null });
      // The author is not a panel account here — the log outlives accounts.
      expect(page.items[0]?.actor).toEqual({ id: ACTOR, name: null, role: null });
    });
  });

  it("pages by cursor, newest first, every entry once", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      const count = AUDIT_LOG_PAGE_SIZE + 5;
      // One timestamp for all of them: the id breaks the tie.
      await write(
        tx,
        Array.from({ length: count }, (_, i) => ({
          action: "student.updated",
          targetId: `t${i}`,
          at: "2099-01-01T10:00:00.000Z",
        })),
      );

      const first = await query.page({ actorId: ACTOR });
      expect(first.items).toHaveLength(AUDIT_LOG_PAGE_SIZE);
      expect(first.nextCursor).not.toBeNull();
      const second = await query.page({ actorId: ACTOR }, first.nextCursor!);
      expect(second.items).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(count);
    });
  });

  it("an export is itself an entry, with the filters and how many rows left", async () => {
    await rolledBack(async (tx) => {
      const query = new AuditLogQuery(tx as unknown as Db);
      await write(tx, [
        { action: "payment.approved", targetId: GONE, at: "2099-01-01T10:00:00.000Z" },
        { action: "payment.rejected", targetId: GONE, at: "2099-01-01T11:00:00.000Z" },
        { action: "student.registered", targetId: GONE, at: "2099-01-01T12:00:00.000Z" },
      ]);

      const exported = await query.export({ actorId: ACTOR, entity: "payment" }, "the-exporter");
      const rows: AuditLogRow[] = [];
      for await (const batch of exported.batches) rows.push(...batch);

      expect(exported.rowCount).toBe(2);
      expect(actionsOf(rows)).toEqual(["payment_rejected", "payment_approved"]);

      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.actorId, "the-exporter"), eq(auditLog.action, "audit_log.exported")));
      expect(entry?.targetId).toBe(AUDIT_LOG_TARGET);
      expect(entry?.metadata).toEqual({
        from: null,
        to: null,
        actorId: ACTOR,
        action: null,
        entity: "payment",
        rowCount: 2,
      });
    });
  });
});
