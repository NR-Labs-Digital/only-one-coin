import * as schema from "@ooc/db";
import { outbox } from "@ooc/db";
import { repositoryEmailContent } from "@ooc/notifications";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEmailTemplateRepository } from "./DrizzleEmailTemplateRepository.js";
import { DrizzleOutboxRepository } from "./DrizzleOutboxRepository.js";

/**
 * Editable e-mail wording against a real, migrated Postgres (OOC-60): one
 * draft per template, rewritten in place; versions numbered per template in
 * the statement that appends them; the outbox row pointing at the version it
 * was sent with. `email_template_versions` is append-only (0082), so every
 * test runs inside a transaction that is always rolled back.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the e-mail wording against a real Postgres.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

const EDITOR = "usr_email_templates_integration";
const CONTENT = repositoryEmailContent("payment_approved");

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
            values (${EDITOR}, 'Gestión', 'emails.integration@test.local', true, 'admin', now(), now())`,
      );
      await fn(tx as unknown as Db);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

describe("DrizzleEmailTemplateRepository", () => {
  it("keeps one draft per template, rewritten in place", async () => {
    await rolledBack(async (tx) => {
      const templates = new DrizzleEmailTemplateRepository(tx);
      const at = new Date("2026-11-27T00:00:00.000Z");
      const edited = { ...CONTENT, "es-PE": { ...CONTENT["es-PE"], subject: "Otro asunto" } };

      await templates.saveDraft({ templateKey: "payment_approved", content: CONTENT, updatedBy: EDITOR, updatedAt: at });
      await templates.saveDraft({ templateKey: "payment_approved", content: edited, updatedBy: EDITOR, updatedAt: at });

      expect((await templates.findDraft("payment_approved"))?.content).toEqual(edited);
      expect(await templates.findDraft("payment_rejected")).toBeNull();
    });
  });

  it("numbers versions per template, newest first, with who published", async () => {
    await rolledBack(async (tx) => {
      const templates = new DrizzleEmailTemplateRepository(tx);
      const base = { content: CONTENT, repositoryVersion: "abcd1234", publishedBy: EDITOR };

      const first = await templates.publish({ id: uuid(), templateKey: "payment_approved", ...base });
      const second = await templates.publish({ id: uuid(), templateKey: "payment_approved", ...base });
      const other = await templates.publish({ id: uuid(), templateKey: "payment_rejected", ...base });

      expect([first.version, second.version, other.version]).toEqual([1, 2, 1]);
      expect((await templates.findPublished("payment_approved"))?.id).toBe(second.id);
      expect((await templates.listVersions("payment_approved")).map((version) => version.version)).toEqual([2, 1]);
      expect(second.publishedByName).toBe("Gestión");
      expect(await templates.latestVersionNumbers()).toMatchObject({ payment_approved: 2, payment_rejected: 1 });
      expect(await templates.findPublished("enrollment_received")).toBeNull();
    });
  });

  it("records on the outbox row the version it went out with", async () => {
    await rolledBack(async (tx) => {
      const version = await new DrizzleEmailTemplateRepository(tx).publish({
        id: uuid(),
        templateKey: "payment_approved",
        content: CONTENT,
        repositoryVersion: "abcd1234",
        publishedBy: EDITOR,
      });
      const [row] = await tx
        .insert(outbox)
        .values({
          templateKey: "payment_approved",
          recipient: "rosa@example.com",
          locale: "es-PE",
          vars: {},
          dedupeKey: `integration:${uuid()}`,
        })
        .returning({ id: outbox.id });

      await new DrizzleOutboxRepository(tx).markSent(row!.id, "<msg@brevo>", version.id);

      const [stored] = await tx.select().from(outbox).where(eq(outbox.id, row!.id));
      expect(stored?.templateVersionId).toBe(version.id);
    });
  });

  it("keeps a draft's frozen words on proof rows only", async () => {
    await rolledBack(async (tx) => {
      const insert = (isProof: boolean) =>
        tx.execute(sql`insert into outbox (template_key, recipient, locale, vars, dedupe_key, is_proof, template_copy)
          values ('payment_approved', 'qa@example.com', 'es-PE', '{}', ${`integration:${uuid()}`}, ${isProof},
                  ${JSON.stringify(CONTENT["es-PE"])}::jsonb)`);

      await expect(insert(true)).resolves.toBeDefined();
      await expect(insert(false)).rejects.toMatchObject({ cause: { constraint: "outbox_template_copy_check" } });
    });
  });
});
