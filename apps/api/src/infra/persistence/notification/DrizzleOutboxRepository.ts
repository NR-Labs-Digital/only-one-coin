import type { EmailNotification, EmailTemplateKey, Locale } from "@ooc/domain";
import { outbox } from "@ooc/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** A transaction in practice; anything that can insert, in type. */
type OutboxWriter = Pick<Tx, "insert">;

export type OutboxStatus = "pending" | "sent" | "blocked" | "failed";

export interface OutboxEmailRow {
  id: string;
  templateKey: EmailTemplateKey;
  recipient: string;
  locale: Locale;
  vars: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  /** A proof from the e-mail screen (OOC-89): the subject goes out marked. */
  isProof: boolean;
}

/**
 * The half of the outbox the delivery side uses: find what is pending and
 * record what happened to it. Every transition is guarded on
 * `status = 'pending'`, so a row that already reached an end state is never
 * moved again — a job that runs twice cannot turn a `sent` into a `failed`.
 */
export interface IOutboxStore {
  listPendingIds(limit: number): Promise<string[]>;
  findById(id: string): Promise<OutboxEmailRow | null>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markBlocked(id: string): Promise<void>;
  /** Counts the attempt and keeps the error code; `final` gives up on it. */
  recordFailedAttempt(id: string, errorCode: string, final: boolean): Promise<void>;
}

/**
 * The write half — called by the repositories that own a business
 * transaction, with THEIR transaction, so the message and the change that
 * caused it commit or roll back together. ON CONFLICT on `dedupe_key` makes a
 * second write of the same message a no-op.
 */
export async function insertOutboxEmails(tx: OutboxWriter, notifications: EmailNotification[]): Promise<void> {
  if (notifications.length === 0) return;

  await tx
    .insert(outbox)
    .values(
      notifications.map((notification) => ({
        channel: "email",
        templateKey: notification.templateKey,
        recipient: notification.to,
        locale: notification.locale,
        vars: notification.vars,
        dedupeKey: notification.dedupeKey,
      })),
    )
    .onConflictDoNothing({ target: outbox.dedupeKey });
}

/**
 * The vars that carry a one-time secret: a link with a raw token (activation,
 * password reset) or the checkout's verification code. The tables behind them
 * keep only hashes, so once a row reaches an end state nobody needs the secret
 * any more, and leaving it in `vars` would undo that hashing. Every final
 * transition strips them in the same UPDATE; a non-final failed attempt keeps
 * them, because the retry still has to send them.
 */
const stripOneTimeSecrets = sql`${outbox.vars} - 'accessUrl' - 'resetUrl' - 'code'`;

export class DrizzleOutboxRepository implements IOutboxStore {
  constructor(private readonly db: Db) {}

  async listPendingIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(eq(outbox.status, "pending"))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findById(id: string): Promise<OutboxEmailRow | null> {
    const [row] = await this.db
      .select({
        id: outbox.id,
        templateKey: outbox.templateKey,
        recipient: outbox.recipient,
        locale: outbox.locale,
        vars: outbox.vars,
        status: outbox.status,
        attempts: outbox.attempts,
        isProof: outbox.isProof,
      })
      .from(outbox)
      .where(eq(outbox.id, id));

    if (!row) return null;

    return {
      ...row,
      templateKey: row.templateKey as EmailTemplateKey,
      locale: row.locale as Locale,
      vars: row.vars as Record<string, unknown>,
      status: row.status as OutboxStatus,
    };
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({
        status: "sent",
        vars: stripOneTimeSecrets,
        providerMessageId,
        attempts: sql`${outbox.attempts} + 1`,
        lastError: null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(outbox.id, id), eq(outbox.status, "pending")));
  }

  async markBlocked(id: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({ status: "blocked", vars: stripOneTimeSecrets, updatedAt: new Date() })
      .where(and(eq(outbox.id, id), eq(outbox.status, "pending")));
  }

  async recordFailedAttempt(id: string, errorCode: string, final: boolean): Promise<void> {
    await this.db
      .update(outbox)
      .set({
        ...(final ? { status: "failed", vars: stripOneTimeSecrets } : {}),
        attempts: sql`${outbox.attempts} + 1`,
        lastError: errorCode,
        updatedAt: new Date(),
      })
      .where(and(eq(outbox.id, id), eq(outbox.status, "pending")));
  }
}
