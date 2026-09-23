import * as schema from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ListStudentsQuery } from "./ListStudentsQuery.js";
import type { Db } from "@/infra/db/client.js";

/**
 * Reproduces the production bug behind "the students directory stalls around
 * page 3": `created_at` carries microsecond precision (no explicit column
 * precision, `packages/db/src/schema.ts`), but a bulk insert — a seed script,
 * an import — evaluates `now()` once per statement, so many rows can share
 * the exact same, non-zero-microsecond timestamp. A cursor built from a
 * `Date` (millisecond precision only) can't reconstruct that boundary: it
 * fails both `<` and `=` against the real column value, so the tie-break by
 * `id` never engages and every row still waiting behind the boundary vanishes
 * from the next page — the API answers 200 with either a truncated page or,
 * when the whole rest of the tie is behind the boundary, zero rows.
 *
 * Runs against a real, migrated Postgres — `pnpm db:up && pnpm db:migrate`,
 * then `DATABASE_URL=... pnpm test:api:db`. Rows are inserted with `pool`
 * directly, not through Drizzle's typed insert: binding a JS `Date` for
 * `created_at` would re-truncate it to milliseconds on the way in, the same
 * loss this test exists to catch on the way out.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises ListStudentsQuery against a real, migrated Postgres.",
  );
}

// A row count comfortably past the query's page size on both sides of the
// tie, so the boundary the fix has to survive is guaranteed to fall
// mid-batch regardless of what that page size is set to.
const TIED_ROW_COUNT = 70;
const TIED_CREATED_AT = "2026-09-07 18:32:28.541523+00";

let pool: pg.Pool;
let db: Db;
let query: ListStudentsQuery;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  query = new ListStudentsQuery(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("begin");
});

afterEach(async () => {
  await pool.query("rollback");
});

async function seedTiedBatch(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await pool.query<{ id: string }>(
      `insert into students
         (first_name, last_name, national_id_type, national_id, email, phone, birth_date, country, city, created_at, updated_at)
       values
         ($1, 'Tied', 'DNI', $2, $3, '+51900000000', '2000-01-01T00:00:00.000Z', 'PE', 'Lima', $4::timestamptz, $4::timestamptz)
       returning id`,
      [`Row${i}`, `TIEDBATCH${i}`, `tied.${i}@gmail.com`, TIED_CREATED_AT],
    );
    ids.push(row.rows[0]!.id);
  }
  return ids;
}

describe("pagination across rows that share one timestamp", () => {
  it("walks the whole tied batch, in full, across pages", async () => {
    const seededIds = await seedTiedBatch(TIED_ROW_COUNT);

    const seen = new Set<string>();
    let cursor: string | undefined;
    let guard = 0;

    do {
      const page = await query.run(undefined, cursor);
      for (const item of page.items) seen.add(item.id);
      cursor = page.nextCursor ?? undefined;
      guard += 1;
    } while (cursor && guard < 10);

    // Every seeded row must be reachable exactly once, cursor never null
    // before the batch is exhausted (a stalled page returning zero rows
    // while a cursor with more of the tie still ahead of it is the bug).
    expect(seen.size).toBe(seededIds.length);
    for (const id of seededIds) expect(seen.has(id)).toBe(true);
  });

  it("advances the cursor past a boundary row that shares its timestamp with the next page", async () => {
    const seededIds = await seedTiedBatch(TIED_ROW_COUNT);

    const first = await query.run();
    expect(first.nextCursor).not.toBeNull();
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(seededIds.length);

    const second = await query.run(undefined, first.nextCursor ?? undefined);

    // Before the fix: the boundary row's truncated-to-millisecond cursor
    // can't match the real, microsecond-precise value of any row still
    // waiting in the tie, so this page comes back empty even though rows
    // are still on file.
    expect(second.items.length).toBeGreaterThan(0);

    const firstIds = new Set(first.items.map((row) => row.id));
    for (const row of second.items) expect(firstIds.has(row.id)).toBe(false);
  });
});
