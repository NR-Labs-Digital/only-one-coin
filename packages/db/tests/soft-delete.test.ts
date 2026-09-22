import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Which tables can have a row retired, asked of the database rather than of
 * the schema file that claims it.
 *
 * `deleted_at` is not a column you add by taste: it decides whether a record
 * can leave the platform's present at all. Migration 0011 already refuses the
 * physical DELETE; this is the other half — where the replacement exists, and
 * just as importantly where it must not, because a table that is append-only
 * (a consent under Ley 29733, a price in force, an audit entry) would be
 * handing out a way to hide what the platform promises to keep.
 *
 * Asserted as an exact set, in both directions: a column appearing where it
 * should not fails here the same way a missing one does.
 *
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite reads the real schema of a migrated Postgres.",
  );
}

/** Rows here can be retired — `deleted_at` instead of a DELETE (CLAUDE.md §6). */
const SOFT_DELETABLE = [
  "academic_periods",
  "class_groups",
  "courses",
  "enrollments",
  "guardians",
  "plans",
  "students",
];

/**
 * Rows here are only ever appended. No `updated_at` either: nothing about them
 * changes after the fact (CLAUDE.md §1 consents, §5 plan_prices, §8 audit_log).
 */
const APPEND_ONLY = ["audit_log", "consents", "plan_prices"];

let db: pg.Client;

beforeAll(async () => {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

async function tablesWithColumn(column: string): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name
       from information_schema.columns
      where table_schema = 'public' and column_name = $1
      order by table_name`,
    [column],
  );

  return rows.map((row) => row.table_name);
}

describe("deleted_at", () => {
  it("is on exactly the tables whose rows can be retired", async () => {
    expect(await tablesWithColumn("deleted_at")).toEqual(SOFT_DELETABLE);
  });

  it("is nullable and timestamptz everywhere it exists", async () => {
    const { rows } = await db.query<{ table_name: string; is_nullable: string; data_type: string }>(
      `select table_name, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public' and column_name = 'deleted_at'`,
    );

    for (const row of rows) {
      // A NOT NULL deleted_at would mean every row is already retired; a
      // timestamp without zone would break "timestamptz sempre" (CLAUDE.md §6).
      expect(row.is_nullable, row.table_name).toBe("YES");
      expect(row.data_type, row.table_name).toBe("timestamp with time zone");
    }
  });
});

describe("append-only tables", () => {
  it("have no deleted_at to hide a row with", async () => {
    const softDeletable = new Set(await tablesWithColumn("deleted_at"));

    for (const table of APPEND_ONLY) {
      expect(softDeletable.has(table), table).toBe(false);
    }
  });

  it("have no updated_at either", async () => {
    const updatable = new Set(await tablesWithColumn("updated_at"));

    for (const table of APPEND_ONLY) {
      expect(updatable.has(table), table).toBe(false);
    }
  });
});

describe("base schema", () => {
  it("gives every soft-deletable table the full set of base columns", async () => {
    const created = new Set(await tablesWithColumn("created_at"));
    const updated = new Set(await tablesWithColumn("updated_at"));

    for (const table of SOFT_DELETABLE) {
      expect(created.has(table), `${table}.created_at`).toBe(true);
      expect(updated.has(table), `${table}.updated_at`).toBe(true);
    }
  });
});
