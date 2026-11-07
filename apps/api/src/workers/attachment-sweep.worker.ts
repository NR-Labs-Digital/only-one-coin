import { Worker, type ConnectionOptions } from "bullmq";
import { ATTACHMENT_SWEEP_QUEUE, QUEUE_PREFIX } from "@ooc/queue";
import type { ExpirePendingAttachmentsUseCase } from "@ooc/domain";
import type { FastifyBaseLogger } from "fastify";

/**
 * Clears uploads that were never confirmed (OOC-143): whatever reached the key
 * is deleted from the bucket and the row is marked `rejected`. Keeps nothing of
 * its own — each row moves by a conditional UPDATE, so a lost tick is made up
 * by the next and a confirm racing the sweep moves the row once.
 */
export function startAttachmentSweepWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: { expirePending: ExpirePendingAttachmentsUseCase },
): Worker {
  return new Worker(
    ATTACHMENT_SWEEP_QUEUE,
    async () => {
      const { expired } = await deps.expirePending.run();
      if (expired > 0) {
        logger.info({ expired }, "attachment sweep cleared uploads never confirmed");
      }
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
