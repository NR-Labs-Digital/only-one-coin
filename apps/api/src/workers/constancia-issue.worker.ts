import { Worker, type ConnectionOptions } from "bullmq";
import { CONSTANCIA_ISSUE_QUEUE, QUEUE_PREFIX } from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";
import type { IssuedDocumentService } from "@/documents/IssuedDocumentService.js";

/**
 * Issues the constancias of paid requests (OOC-33). Keeps nothing of its own:
 * a request moves `paid → fulfilled` in the same transaction as its document,
 * conditionally, so a lost tick is made up by the next and two ticks never
 * issue twice. While the constancia's template has no published version it
 * issues nothing, and the requests wait.
 */
export function startConstanciaIssueWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { issued: IssuedDocumentService },
): Worker {
  return new Worker(
    CONSTANCIA_ISSUE_QUEUE,
    async () => {
      const { issued, unprintable } = await deps.issued.issuePendingConstancias();
      if (issued > 0) logger.info({ issued }, "constancias issued");
      // Ids and counts only: the template lacks a value these files do not have.
      if (unprintable > 0) logger.warn({ unprintable }, "constancias waiting: the template prints a value the file lacks");
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
