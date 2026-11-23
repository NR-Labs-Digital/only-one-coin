import * as schema from "@ooc/db";
import { outbox, staffPasswordResets } from "@ooc/db";
import type { EmailNotification, IssueSelfServiceResetRecord, StaffPasswordReset } from "@ooc/domain";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleStaffPasswordResetRepository } from "./DrizzleStaffPasswordResetRepository.js";
import { DrizzleStaffUserLookup } from "./DrizzleStaffUserLookup.js";

/**
 * "Forgot my password" against a real, migrated Postgres (OOC-30). What the
 * type checker cannot see: the upsert lands on the partial one-pending-per-user
 * index, never shortens a pending link, answers nothing inside the cooldown —
 * and the e-mail row commits only when the link does. Plus the lookup's notion
 * of who may recover a panel password at all.
 *
 * Runs with `pnpm test:api:db`. Every test runs inside one transaction that is
 * always rolled back; the repository's own transaction nests as a savepoint.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the password-reset SQL against a real, migrated Postgres.");
}

const STAFF = "usr_ooc30_staff";
const STUDENT = "usr_ooc30_student";
const BANNED = "usr_ooc30_banned";
const STAFF_EMAIL = "ooc30.staff@example.com";

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
      await seedUsers(tx as unknown as Db);
      await fn(tx as unknown as Db);
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}

async function seedUsers(tx: Db): Promise<void> {
  await tx.execute(sql`
    insert into "user" ("id", "name", "email", "emailVerified", "role", "banned") values
      (${STAFF}, 'Rosa Quispe', ${STAFF_EMAIL}, true, 'admin', false),
      (${STUDENT}, 'Alumno Prueba', 'ooc30.student@example.com', true, 'student', false),
      (${BANNED}, 'Ex Staff', 'ooc30.banned@example.com', true, 'billing', true)
  `);
}

const T0 = new Date("2026-10-03T15:00:00.000Z");
const minutes = (n: number) => n * 60_000;

function record(overrides: Partial<IssueSelfServiceResetRecord> = {}): IssueSelfServiceResetRecord {
  const requestedAt = overrides.requestedAt ?? T0;
  return {
    userId: STAFF,
    token: `token-${requestedAt.getTime()}`,
    expiresAt: new Date(requestedAt.getTime() + minutes(60)),
    requestedAt,
    cooldownSince: new Date(requestedAt.getTime() - 60_000),
    ...overrides,
  };
}

function notify(reset: StaffPasswordReset): EmailNotification[] {
  return [
    {
      templateKey: "staff_password_reset",
      to: STAFF_EMAIL,
      locale: "es-PE",
      vars: { recipientName: "Rosa Quispe", resetUrl: `https://backoffice.test/reset-password/${reset.token}` },
      dedupeKey: `staff_password_reset:${reset.id}:${reset.expiresAt.getTime()}:${Math.random()}`,
    },
  ];
}

async function outboxFor(tx: Db) {
  return tx.select().from(outbox).where(eq(outbox.recipient, STAFF_EMAIL));
}

describe("DrizzleStaffUserLookup.findResettableStaffByEmail", () => {
  it("finds a staff account, and nobody else", async () => {
    await inRolledBackTransaction(async (tx) => {
      const lookup = new DrizzleStaffUserLookup(tx);

      expect(await lookup.findResettableStaffByEmail(STAFF_EMAIL)).toEqual({
        id: STAFF,
        name: "Rosa Quispe",
        email: STAFF_EMAIL,
        role: "admin",
      });
      expect(await lookup.findResettableStaffByEmail("ooc30.student@example.com")).toBeNull();
      expect(await lookup.findResettableStaffByEmail("ooc30.banned@example.com")).toBeNull();
      expect(await lookup.findResettableStaffByEmail("ooc30.nobody@example.com")).toBeNull();
    });
  });
});

describe("DrizzleStaffPasswordResetRepository.issueSelfService", () => {
  it("opens a pending reset and writes its e-mail in the same transaction", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleStaffPasswordResetRepository(tx);

      const reset = await repository.issueSelfService(record(), notify);

      expect(reset).toMatchObject({ userId: STAFF, token: `token-${T0.getTime()}`, status: "pending" });
      expect(reset!.expiresAt).toEqual(new Date(T0.getTime() + minutes(60)));
      const [row] = await tx.select().from(staffPasswordResets).where(eq(staffPasswordResets.id, reset!.id));
      expect(row!.requestedBy).toBe(STAFF);
      const emails = await outboxFor(tx);
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({ templateKey: "staff_password_reset", status: "pending" });
    });
  });

  it("answers null and writes nothing inside the cooldown", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleStaffPasswordResetRepository(tx);
      const first = await repository.issueSelfService(record(), notify);

      const second = await repository.issueSelfService(record({ requestedAt: new Date(T0.getTime() + 30_000) }), notify);

      expect(second).toBeNull();
      const rows = await tx.select().from(staffPasswordResets).where(eq(staffPasswordResets.userId, STAFF));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.expiresAt).toEqual(first!.expiresAt);
      expect(await outboxFor(tx)).toHaveLength(1);
    });
  });

  it("after the cooldown, keeps the same link, extends it and e-mails it again", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleStaffPasswordResetRepository(tx);
      const first = await repository.issueSelfService(record(), notify);
      const later = new Date(T0.getTime() + minutes(5));

      const second = await repository.issueSelfService(record({ requestedAt: later }), notify);

      expect(second!.id).toBe(first!.id);
      expect(second!.token).toBe(first!.token);
      expect(second!.expiresAt).toEqual(new Date(later.getTime() + minutes(60)));
      expect(await outboxFor(tx)).toHaveLength(2);
    });
  });

  it("never shortens a longer link an admin already generated", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleStaffPasswordResetRepository(tx);
      const adminExpiry = new Date(T0.getTime() + minutes(24 * 60));
      const adminLink = await repository.create({
        userId: STAFF,
        token: "admin-token",
        requestedBy: "usr_admin",
        expiresAt: adminExpiry,
      });
      await tx
        .update(staffPasswordResets)
        .set({ updatedAt: new Date(T0.getTime() - minutes(10)) })
        .where(eq(staffPasswordResets.id, adminLink.id));

      const reset = await repository.issueSelfService(record(), notify);

      expect(reset!.id).toBe(adminLink.id);
      expect(reset!.token).toBe("admin-token");
      expect(reset!.expiresAt).toEqual(adminExpiry);
    });
  });

  it("opens a fresh reset once the previous one was used", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repository = new DrizzleStaffPasswordResetRepository(tx);
      const first = await repository.issueSelfService(record(), notify);
      await repository.markCompleted(first!.id);

      const second = await repository.issueSelfService(record({ requestedAt: new Date(T0.getTime() + 1000) }), notify);

      expect(second!.id).not.toBe(first!.id);
      expect(second!.status).toBe("pending");
    });
  });
});
