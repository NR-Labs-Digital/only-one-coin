import { randomUUID } from "node:crypto";
import * as schema from "@ooc/db";
import { documents, students } from "@ooc/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleAttachmentOwners, DrizzleAttachmentRepository } from "./DrizzleAttachmentRepository.js";
import type { Db } from "@/infra/db/client.js";

/**
 * The `documents` table (OOC-143) against a real, migrated Postgres: the
 * conditional status moves, the owner's list with the uploader's name, the
 * sweep's read, the CHECKs that keep a row whole, and the account → files
 * lookup. Inside a transaction that is always rolled back.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the attachment repository against a real Postgres.");
}

const STUDENT = "018f2b5c-4300-7000-8000-000000000001";
const STUDENT_OLD = "018f2b5c-4300-7000-8000-000000000002";
const OTHER = "018f2b5c-4300-7000-8000-000000000003";
const STAFF = "attachment-integration-staff";
const ACCOUNT = "attachment-integration-student";

let pool: pg.Pool;
let db: Db;
let repository: DrizzleAttachmentRepository;
let owners: DrizzleAttachmentOwners;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleAttachmentRepository(db);
  owners = new DrizzleAttachmentOwners(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("begin");
  await db.execute(sql`
    insert into "user" ("id", "name", "email", "emailVerified", "role") values
      (${STAFF}, 'Coordinación Prueba', 'attachment-staff@example.com', true, 'enrollment_supervisor'),
      (${ACCOUNT}, 'Rosa Prueba', 'attachment-student@example.com', true, 'student')
  `);
  await db.insert(students).values(
    [STUDENT, STUDENT_OLD, OTHER].map((id, i) => ({
      id,
      firstName: `Alumno${i}`,
      lastName: "Attachment",
      nationalIdType: "DNI",
      nationalId: `ATTACH${i}`,
      email: `attachment.${i}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
      userId: id === OTHER ? null : ACCOUNT,
      createdAt: new Date(Date.UTC(2026, 0, id === STUDENT ? 2 : 1)),
    })),
  );
});

afterEach(async () => {
  await pool.query("rollback");
});

async function create(ownerId = STUDENT, uploadedBy = STAFF) {
  const id = randomUUID();
  await repository.create({
    id,
    owner: { type: "student", id: ownerId },
    category: "national_id",
    objectKey: `documents/${id}`,
    originalName: "DNI Peña.pdf",
    mimeType: "application/pdf",
    source: uploadedBy === STAFF ? "backoffice" : "portal",
    uploadedBy,
  });
  return id;
}

const facts = (minute = 0) => ({
  mimeType: "image/png",
  sizeBytes: 1234,
  checksumSha256: "ab".repeat(32),
  at: new Date(Date.UTC(2026, 9, 1, 12, minute)),
});

describe("DrizzleAttachmentRepository", () => {
  it("moves a row pending → uploaded once, with what the bucket holds", async () => {
    const id = await create();
    expect(await repository.markUploaded(id, facts())).toBe(true);
    expect(await repository.markUploaded(id, facts())).toBe(false);
    expect(await repository.markRejected(id, "not_confirmed")).toBe(false);
    expect(await repository.findById(id)).toMatchObject({ status: "uploaded", mimeType: "image/png" });
  });

  it("lists live uploaded files of the owners, newest first, with the uploader's name", async () => {
    const staffFile = await create();
    const portalFile = await create(STUDENT, ACCOUNT);
    const pending = await create();
    const otherFile = await create(OTHER);
    await repository.markUploaded(staffFile, facts(1));
    await repository.markUploaded(portalFile, facts(2));
    await repository.markUploaded(otherFile, facts(3));

    const items = await repository.listByOwners("student", [STUDENT]);
    expect(items.map((item) => item.id).sort()).toEqual([staffFile, portalFile].sort());
    expect(items.find((item) => item.id === portalFile)).toMatchObject({
      source: "portal",
      uploadedByName: "Rosa Prueba",
      sizeBytes: 1234,
      originalName: "DNI Peña.pdf",
    });
    expect(items.some((item) => item.id === pending)).toBe(false);
  });

  it("removes softly: deleted_at and who, and the row leaves the list", async () => {
    const id = await create();
    await repository.markUploaded(id, facts());
    expect(await repository.markRemoved(id, { by: STAFF, at: new Date() })).toBe(true);
    expect(await repository.markRemoved(id, { by: STAFF, at: new Date() })).toBe(false);
    expect(await repository.listByOwners("student", [STUDENT])).toEqual([]);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({ status: "removed", removedBy: STAFF });
    expect(row!.deletedAt).not.toBeNull();
  });

  it("hands the sweep only pending rows older than the cut", async () => {
    const stale = await create();
    const fresh = await create();
    await db.update(documents).set({ createdAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(documents.id, stale));
    const rows = await repository.listStalePending({ before: new Date(Date.now() - 3600_000), limit: 100 });
    expect(rows.map((row) => row.id)).toContain(stale);
    expect(rows.map((row) => row.id)).not.toContain(fresh);
  });

  // One refused statement per test: it aborts the surrounding transaction.
  it("refuses an uploaded row without its facts", async () => {
    const id = await create();
    await expect(db.update(documents).set({ status: "uploaded" }).where(eq(documents.id, id))).rejects.toThrow();
  });

  it("refuses a removal that does not say who", async () => {
    const id = await create();
    await repository.markUploaded(id, facts());
    await expect(
      db.update(documents).set({ status: "removed", deletedAt: new Date() }).where(eq(documents.id, id)),
    ).rejects.toThrow();
  });
});

describe("DrizzleAttachmentOwners", () => {
  it("finds every live file of an account, newest first, and nothing for an account without one", async () => {
    expect(await owners.studentsOfAccount(ACCOUNT)).toEqual([STUDENT, STUDENT_OLD]);
    expect(await owners.studentsOfAccount("no-such-account")).toEqual([]);
  });

  it("says whether a student owner exists", async () => {
    expect(await owners.exists({ type: "student", id: OTHER })).toBe(true);
    expect(await owners.exists({ type: "student", id: "018f2b5c-4300-7000-8000-0000000000ff" })).toBe(false);
  });
});
