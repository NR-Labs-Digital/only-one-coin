import * as schema from "@ooc/db";
import { auditLog, outbox } from "@ooc/db";
import { SendEmailProofUseCase } from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { EMAIL_PREVIEW_SAMPLES } from "@/http/email/emailPreviewSamples.js";
import { DrizzleEmailProofRepository } from "./DrizzleEmailProofRepository.js";
import { DrizzleEmailResendRepository } from "./DrizzleEmailResendRepository.js";
import { EmailDeliveryQuery } from "./EmailDeliveryQuery.js";

/**
 * The proof send (OOC-89) against a real, migrated Postgres: one proof row per
 * address and the audit entry, in one transaction; and a proof that failed
 * never reaches the undelivered list or the resend. Every test runs inside a
 * transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the outbox against a real, migrated Postgres.");
}

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

const proofOf = (tx: Db) => new SendEmailProofUseCase(new DrizzleEmailProofRepository(tx));

describe("DrizzleEmailProofRepository", () => {
  it("writes one pending proof row per address and the audit entry together", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { outboxIds } = await proofOf(tx).run({
        actorId: "staff-integration",
        templateKey: "payment_approved",
        locale: "en",
        recipients: ["proof.one@onlyonecoin.edu.pe", "proof.two@onlyonecoin.edu.pe"],
        vars: EMAIL_PREVIEW_SAMPLES.payment_approved as Record<string, unknown>,
      });

      const rows = await tx.select().from(outbox).where(inArray(outbox.id, outboxIds));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.isProof && row.status === "pending" && row.locale === "en")).toBe(true);
      expect(rows.map((row) => row.recipient).sort()).toEqual([
        "proof.one@onlyonecoin.edu.pe",
        "proof.two@onlyonecoin.edu.pe",
      ]);

      const [entry] = await tx.select().from(auditLog).where(eq(auditLog.action, "email.proof_sent"));
      expect(entry?.metadata).toMatchObject({ template: "payment_approved", recipients: 2 });
      expect(JSON.stringify(entry?.metadata)).not.toContain("proof.one");
    });
  });

  it("keeps a failed proof out of the undelivered list and the resend", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { outboxIds } = await proofOf(tx).run({
        actorId: "staff-integration",
        templateKey: "payment_rejected",
        locale: "es-PE",
        recipients: ["proof.failed@onlyonecoin.edu.pe"],
        vars: EMAIL_PREVIEW_SAMPLES.payment_rejected as Record<string, unknown>,
      });
      const proofId = outboxIds[0]!;
      await tx.update(outbox).set({ status: "failed", lastError: "brevo_http_400" }).where(eq(outbox.id, proofId));

      const { items } = await new EmailDeliveryQuery(tx).list({});
      expect(items.map((item) => item.id)).not.toContain(proofId);
      expect(await new DrizzleEmailResendRepository(tx).findDelivery(proofId)).toBeNull();
    });
  });
});
