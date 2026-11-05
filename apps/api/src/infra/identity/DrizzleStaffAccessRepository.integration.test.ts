import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import { retiredStaffEmail } from "@ooc/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { ListStaffQuery } from "@/infra/persistence/identity/ListStaffQuery.js";
import { DrizzleStaffAccessRepository } from "./DrizzleStaffAccessRepository.js";

/**
 * Retiring a panel account against the real "user" and "session" tables. "user"
 * is not under the delete lock (0011), so afterAll removes the rows it created.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const created: string[] = [];
let pool: pg.Pool;
let db: Db;
let repository: DrizzleStaffAccessRepository;

async function insertUser(role: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `retire-${id}@example.com`;
  created.push(id);
  await db.execute(sql`
    insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
    values (${id}, 'Rick Test', ${email}, true, ${role}, now(), now())`);
  await db.execute(sql`
    insert into "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId")
    values (${randomUUID()}, now() + interval '1 hour', ${randomUUID()}, now(), now(), ${id})`);
  return { id, email };
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleStaffAccessRepository(db);
});

afterAll(async () => {
  if (created.length > 0) {
    await db.execute(sql`delete from "user" where "id" in (${sql.join(created.map((id) => sql`${id}`), sql`, `)})`);
  }
  await pool.end();
});

describe("DrizzleStaffAccessRepository.retire", () => {
  it("closes the account, ends its sessions, frees its e-mail and hides it from the team", async () => {
    const { id, email } = await insertUser("sales");

    expect(await repository.findRetirable(id)).toEqual({ email, role: "sales", hasTeacherFile: false });
    expect(await repository.retire(id, retiredStaffEmail(id))).toBe(true);

    const row = await db.execute<{ email: string; banned: boolean; deletedAt: string | null }>(
      sql`select "email", "banned", "deletedAt" from "user" where "id" = ${id}`,
    );
    expect(row.rows[0]).toMatchObject({ email: retiredStaffEmail(id), banned: true });
    expect(row.rows[0]?.deletedAt).not.toBeNull();

    const sessions = await db.execute(sql`select 1 from "session" where "userId" = ${id}`);
    expect(sessions.rows).toEqual([]);

    const team = await new ListStaffQuery(db).run();
    expect(team.map((member) => member.id)).not.toContain(id);

    // The same address can open a new account (unique "user".email).
    const next = randomUUID();
    created.push(next);
    await db.execute(sql`
      insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
      values (${next}, 'Rick Test', ${email}, true, 'sales', now(), now())`);
  });

  it("never reopens or touches a retired account", async () => {
    const { id } = await insertUser("sales");
    await repository.retire(id, retiredStaffEmail(id));

    expect(await repository.unban(id)).toBe(false);
    expect(await repository.ban(id, "again")).toBe(false);
    expect(await repository.findRetirable(id)).toBeNull();
    expect(await repository.retire(id, "other@retired.invalid")).toBe(false);

    const row = await db.execute<{ banned: boolean; email: string }>(
      sql`select "banned", "email" from "user" where "id" = ${id}`,
    );
    expect(row.rows[0]).toEqual({ banned: true, email: retiredStaffEmail(id) });
  });

  it("does not retire a student account", async () => {
    const { id } = await insertUser("student");

    expect(await repository.findRetirable(id)).toBeNull();
    expect(await repository.retire(id, retiredStaffEmail(id))).toBe(false);
  });
});
