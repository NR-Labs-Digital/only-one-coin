import { Worker, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX, REPORT_REFRESH_QUEUE } from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";
import type { ReportFactsRefresher } from "@/infra/persistence/report/ReportFactsRefresher.js";

/**
 * Rebuilds the reports' aggregation (OOC-40), nightly and at boot when the last
 * refresh is stale. Keeps nothing of its own: the refresh is one transaction
 * that replaces every fact, so a failed night leaves yesterday's figures in
 * place and the next run catches up.
 */
export function startReportRefreshWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { refresher: ReportFactsRefresher },
): Worker {
  return new Worker(
    REPORT_REFRESH_QUEUE,
    async () => {
      const { durationMs } = await deps.refresher.refresh();
      logger.info({ durationMs }, "report aggregation refreshed");
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
