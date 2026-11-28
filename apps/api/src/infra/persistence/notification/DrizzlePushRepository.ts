import { MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT, PUSH_MAX_AGE_HOURS, type EmailTemplateKey, type Locale } from "@ooc/domain";
import { outbox, pushSubscriptions } from "@ooc/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** Where a push ended (OOC-51); `sending` is the claim, never an end. */
export type PushOutcome = "sent" | "no_device" | "blocked" | "failed";

/** The outbox row a push is made of: the same message the e-mail carries. */
export interface PushOutboxRow {
  id: string;
  templateKey: EmailTemplateKey;
  recipient: string;
  locale: Locale;
  vars: Record<string, unknown>;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The push half of the outbox, used by the relay and the send-push worker. */
export interface IPushOutboxStore {
  listPendingPushIds(limit: number): Promise<string[]>;
  /**
   * Takes the row for this attempt (`pending → sending`) and returns it, or
   * null when another run took it, it was never meant to be pushed, or it is
   * too old to be news. At most once: a push that dies after the claim is
   * lost, never sent twice.
   */
  claimPush(id: string): Promise<PushOutboxRow | null>;
  finishPush(id: string, outcome: PushOutcome): Promise<void>;
}

/** The devices the recipient's portal account subscribed. */
export interface IPushSubscriptionStore {
  listForRecipient(email: string): Promise<PushSubscriptionRow[]>;
  /** The push service said the subscription is gone (404/410). */
  forgetEndpoint(endpoint: string): Promise<void>;
}

/** What the portal routes write: the session's own devices, never another account's. */
export interface IPushSubscriptionWriter {
  subscribe(userId: string, subscription: PushSubscriptionRow): Promise<void>;
  unsubscribe(userId: string, endpoint: string): Promise<void>;
}

const recent = sql`${outbox.createdAt} > now() - make_interval(hours => ${PUSH_MAX_AGE_HOURS})`;

export class DrizzlePushRepository implements IPushOutboxStore, IPushSubscriptionStore, IPushSubscriptionWriter {
  constructor(private readonly db: Db) {}

  async listPendingPushIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(and(eq(outbox.pushStatus, "pending"), recent))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async claimPush(id: string): Promise<PushOutboxRow | null> {
    const [row] = await this.db
      .update(outbox)
      .set({ pushStatus: "sending", updatedAt: new Date() })
      .where(and(eq(outbox.id, id), eq(outbox.pushStatus, "pending"), recent))
      .returning({
        id: outbox.id,
        templateKey: outbox.templateKey,
        recipient: outbox.recipient,
        locale: outbox.locale,
        vars: outbox.vars,
      });
    if (!row) return null;
    return {
      ...row,
      templateKey: row.templateKey as EmailTemplateKey,
      locale: row.locale as Locale,
      vars: row.vars as Record<string, unknown>,
    };
  }

  async finishPush(id: string, outcome: PushOutcome): Promise<void> {
    await this.db
      .update(outbox)
      .set({ pushStatus: outcome, updatedAt: new Date() })
      .where(and(eq(outbox.id, id), eq(outbox.pushStatus, "sending")));
  }

  /**
   * The e-mail's recipient is an address; its devices belong to the portal
   * account with that e-mail (compared without case — the same comparison the
   * guardian's reach uses). Only portal accounts, never staff, never a
   * blocked one. A minor's guardian, with their own account (OOC-147), gets
   * the push of the copy addressed to them.
   */
  async listForRecipient(email: string): Promise<PushSubscriptionRow[]> {
    const result = await this.db.execute<PushSubscriptionRow & Record<string, unknown>>(sql`
      select s."endpoint", s."p256dh", s."auth"
        from ${pushSubscriptions} s
        join "user" u on u."id" = s."user_id"
       where lower(u."email") = lower(${email})
         and u."role" in ('student', 'guardian')
         and coalesce(u."banned", false) = false
       order by s."updated_at" desc`);
    return result.rows.map((row) => ({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
  }

  async forgetEndpoint(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  /**
   * One row per browser. The same browser subscribing again (a new key after
   * the browser rotated it, or another account signed in on it) takes the
   * row over — a device follows the account that turned push on last. Past
   * the per-account cap, the oldest devices are dropped: they are most likely
   * a reinstalled app whose old subscription nobody will ever use.
   */
  async subscribe(userId: string, subscription: PushSubscriptionRow): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({ userId, ...subscription })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId, p256dh: subscription.p256dh, auth: subscription.auth, updatedAt: new Date() },
        });
      await tx.execute(sql`
        delete from ${pushSubscriptions}
         where "user_id" = ${userId}
           and "id" not in (
             select "id" from ${pushSubscriptions}
              where "user_id" = ${userId}
              order by "updated_at" desc
              limit ${MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT})`);
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }
}
