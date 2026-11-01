import { EMAIL_CATALOG_KEYS, type EmailCatalogKey } from "@ooc/domain";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** How far back the e-mail screens count (OOC-88). A screen window, not a business rule. */
export const EMAIL_FLOW_WINDOW_DAYS = 30;

/**
 * What the outbox knows about a template's messages over the window. Only the
 * statuses the platform itself writes: whether the receiving server accepted
 * a `sent` message, or bounced it, is the provider's to report back, and
 * there is no webhook yet — so there is no delivered or bounced figure here
 * at all, rather than one that would read as zero.
 */
export interface EmailFlowCounts {
  sent: number;
  /** The provider refused it or the retries ran out. */
  failed: number;
  /** The staging allowlist refused the recipient (CLAUDE.md §6) — zero in production. */
  blocked: number;
}

interface CountsRow extends Record<string, unknown> {
  template_key: string;
  sent: number | string;
  failed: number | string;
  blocked: number | string;
}

const EMPTY: EmailFlowCounts = { sent: 0, failed: 0, blocked: 0 };

/**
 * The outbox counted per template and status (OOC-88). A message counts on
 * the day it was written to the outbox — the moment the domain decided it
 * must go out — whichever status it ended in. `pending` is left out: it is
 * on its way, and the relay picks it up within seconds.
 *
 * Every catalog entry comes back, with zeros where nothing was written: a
 * template nothing sends yet still has a row on the screen. A key in the
 * outbox the catalog no longer names is ignored.
 */
export class EmailFlowCountsQuery {
  constructor(private readonly db: Db) {}

  async run(now: Date = new Date()): Promise<Record<EmailCatalogKey, EmailFlowCounts>> {
    const since = new Date(now.getTime() - EMAIL_FLOW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db.execute<CountsRow>(sql`
      select
        template_key,
        count(*) filter (where status = 'sent') as sent,
        count(*) filter (where status = 'failed') as failed,
        count(*) filter (where status = 'blocked') as blocked
      from outbox
      where created_at >= ${since}::timestamptz
        and created_at <= ${now.toISOString()}::timestamptz
      group by template_key
    `);

    const counts = Object.fromEntries(EMAIL_CATALOG_KEYS.map((key) => [key, { ...EMPTY }])) as Record<
      EmailCatalogKey,
      EmailFlowCounts
    >;
    for (const row of result.rows) {
      if (!(EMAIL_CATALOG_KEYS as string[]).includes(row.template_key)) continue;
      counts[row.template_key as EmailCatalogKey] = {
        sent: Number(row.sent),
        failed: Number(row.failed),
        blocked: Number(row.blocked),
      };
    }
    return counts;
  }
}
