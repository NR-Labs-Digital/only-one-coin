import { academicPeriods } from "@ooc/db";
import { and, desc, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface CurrentPeriod {
  id: string;
  name: string;
}

/**
 * The period the backoffice headers count over (OOC-151): the most recent one
 * already started and not retired. One definition for the Payments header, the
 * Enrollments header and the home's seat occupancy (OOC-160) — a period opened
 * ahead of time (all drafts) never takes over before it starts. `null` when no
 * period has started: nothing to count.
 */
export async function currentPeriod(db: Db, now?: Date): Promise<CurrentPeriod | null> {
  const at = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const [period] = await db
    .select({ id: academicPeriods.id, name: academicPeriods.name })
    .from(academicPeriods)
    .where(and(sql`${academicPeriods.startsOn} <= ${at}`, isNull(academicPeriods.deletedAt)))
    .orderBy(desc(academicPeriods.startsOn), desc(academicPeriods.id))
    .limit(1);
  return period ?? null;
}
