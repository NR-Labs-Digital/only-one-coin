import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { REPORT_REFRESH_PATTERN, REPORT_REFRESH_QUEUE, REPORT_REFRESH_TIMEZONE } from "../jobs/report-refresh.job.js";

export function createReportRefreshQueue(connection: ConnectionOptions): Queue {
  return new Queue(REPORT_REFRESH_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleReportRefresh(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    REPORT_REFRESH_QUEUE,
    { pattern: REPORT_REFRESH_PATTERN, tz: REPORT_REFRESH_TIMEZONE },
    { name: REPORT_REFRESH_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}

/**
 * One refresh now, out of schedule. The fixed job id makes a second call while
 * the first is still waiting a no-op, so two boots in a row never queue two.
 */
export async function enqueueReportRefreshNow(queue: Queue): Promise<void> {
  await queue.add(REPORT_REFRESH_QUEUE, {}, { jobId: `${REPORT_REFRESH_QUEUE}-now`, removeOnComplete: true, removeOnFail: 100 });
}
