import * as schema from "@ooc/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleDocumentTemplateRepository } from "./DrizzleDocumentTemplateRepository.js";

/**
 * Document templates against a real, migrated Postgres (OOC-123): one draft per
 * kind, rewritten in place; versions numbered per kind in the same statement
 * that appends them. `document_template_versions` is append-only (0034), so
 * every test runs inside a transaction that is always rolled back.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the document templates against a real Postgres.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

const EDITOR = "usr_document_templates_integration";

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

async function rolledBack(fn: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx: Tx) => {
      await tx.execute(
        sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
            values (${EDITOR}, 'Gestión', 'documents.integration@test.local', true, 'admin', now(), now())`,
      );
      await fn(tx as unknown as Db);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

describe("DrizzleDocumentTemplateRepository", () => {
  it("keeps one draft per kind, rewritten in place", async () => {
    await rolledBack(async (tx) => {
      const templates = new DrizzleDocumentTemplateRepository(tx);
      const at = new Date("2026-10-24T00:00:00.000Z");

      await templates.saveDraft({ kind: "teacher_contract", body: "<p>uno</p>", updatedBy: EDITOR, updatedAt: at });
      await templates.saveDraft({ kind: "teacher_contract", body: "<p>dos</p>", updatedBy: EDITOR, updatedAt: at });

      expect((await templates.findDraft("teacher_contract"))?.body).toBe("<p>dos</p>");
      expect(await templates.findDraft("other_kind")).toBeNull();
      const [{ count }] = (
        await tx.execute<{ count: string }>(sql`select count(*) from document_template_drafts where kind = 'teacher_contract'`)
      ).rows as [{ count: string }];
      expect(Number(count)).toBe(1);
    });
  });

  it("numbers versions per kind and answers the highest as the one in force", async () => {
    await rolledBack(async (tx) => {
      const templates = new DrizzleDocumentTemplateRepository(tx);

      const first = await templates.publish({ id: uuid(), kind: "teacher_contract", body: "<p>v1</p>", publishedBy: EDITOR });
      const second = await templates.publish({ id: uuid(), kind: "teacher_contract", body: "<p>v2</p>", publishedBy: EDITOR });
      const other = await templates.publish({ id: uuid(), kind: "certificate", body: "<p>c1</p>", publishedBy: EDITOR });

      expect([first.version, second.version, other.version]).toEqual([1, 2, 1]);
      expect((await templates.findPublished("teacher_contract"))?.body).toBe("<p>v2</p>");
      expect(await templates.findPublished("nothing_yet")).toBeNull();
    });
  });

  it("refuses two versions of a kind with the same number — the guarantee behind concurrent publishes", async () => {
    await rolledBack(async (tx) => {
      const templates = new DrizzleDocumentTemplateRepository(tx);
      await templates.publish({ id: uuid(), kind: "teacher_contract", body: "<p>v1</p>", publishedBy: EDITOR });

      await expect(
        tx.execute(
          sql`insert into document_template_versions (id, kind, version, body, published_by)
              values (${uuid()}, 'teacher_contract', 1, '<p>racer</p>', ${EDITOR})`,
        ),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23505" }) });
    });
  });
});
