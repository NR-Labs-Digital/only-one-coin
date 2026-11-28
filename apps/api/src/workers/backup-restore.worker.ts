import { Worker, type ConnectionOptions } from "bullmq";
import { BACKUP_RESTORE_QUEUE, QUEUE_PREFIX } from "@ooc/queue";
import type { RunNextBackupRestoreUseCase } from "@ooc/domain";
import type { FastifyBaseLogger } from "fastify";

/**
 * Runs queued backup restores (OOC-153), one at a time. The row is the job:
 * a tick claims the oldest queued restore atomically, so two machines (the
 * blue-green deploy) never run the same one, and a restore a dead machine left
 * running is closed by the next tick once its heartbeat stops.
 *
 * Logs ids, the outcome and the reason code — never what psql printed, which
 * can carry a row of student data (CLAUDE.md §6).
 */
export function startBackupRestoreWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { runNext: RunNextBackupRestoreUseCase },
): Worker {
  return new Worker(
    BACKUP_RESTORE_QUEUE,
    async () => {
      const outcome = await deps.runNext.run();
      if (outcome.kind === "passed") {
        logger.info({ restoreId: outcome.restoreId, durationSeconds: outcome.durationSeconds }, "backup restore passed");
      } else if (outcome.kind === "failed") {
        const cause = outcome.error instanceof Error ? (outcome.error.cause ?? outcome.error) : undefined;
        logger.warn(
          {
            restoreId: outcome.restoreId,
            reason: outcome.reason,
            // Our own messages (status codes, exit codes, dump line numbers) —
            // psql's text never travels in them.
            detail: cause instanceof Error ? cause.message : undefined,
          },
          "backup restore failed; its scratch database was dropped",
        );
      }
    },
    // One restore at a time, and a long one: the lock is renewed while the
    // stream runs, so a generous duration only matters if the loop stalls.
    { connection, prefix: QUEUE_PREFIX, concurrency: 1, lockDuration: 120_000 },
  );
}
