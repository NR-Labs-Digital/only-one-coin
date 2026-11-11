import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleUserPreferenceRepository } from "./DrizzleUserPreferenceRepository.js";

/**
 * The account's own language (OOC-150) against the real "user" table and the
 * CHECK of 0053. "user" is not under the delete lock (0011), so afterAll
 * removes the rows it created.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const created: string[] = [];
let pool: pg.Pool;
let db: Db;
let repository: DrizzleUserPreferenceRepository;

async function insertUser(): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await db.execute(sql`
    insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
    values (${id}, 'Ana Test', ${`locale-${id}@example.com`}, true, 'student', now(), now())`);
  return id;
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleUserPreferenceRepository(db);
});

afterAll(async () => {
  if (created.length > 0) {
    await db.execute(sql`delete from "user" where "id" in (${sql.join(created.map((id) => sql`${id}`), sql`, `)})`);
  }
  await pool.end();
});

describe("DrizzleUserPreferenceRepository", () => {
  it("is null until the account chooses, then keeps the last choice", async () => {
    const id = await insertUser();
    expect(await repository.findPreferredLocale(id)).toBeNull();

    await repository.setPreferredLocale(id, "pt-BR");
    expect(await repository.findPreferredLocale(id)).toBe("pt-BR");

    await repository.setPreferredLocale(id, "en");
    expect(await repository.findPreferredLocale(id)).toBe("en");
  });

  it("touches only the account it is given", async () => {
    const [mine, theirs] = [await insertUser(), await insertUser()];
    await repository.setPreferredLocale(mine, "en");
    expect(await repository.findPreferredLocale(theirs)).toBeNull();
  });

  it("answers null for an account that does not exist", async () => {
    expect(await repository.findPreferredLocale(randomUUID())).toBeNull();
  });

  it("is held to the three locales by the database itself", async () => {
    const id = await insertUser();
    await expect(db.execute(sql`update "user" set "preferredLocale" = 'qu' where "id" = ${id}`)).rejects.toThrow();
  });
});
