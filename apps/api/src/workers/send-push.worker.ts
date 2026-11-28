import { Worker, type ConnectionOptions } from "bullmq";
import { SEND_PUSH_QUEUE, SendPushPayloadSchema, type SendPushPayload, QUEUE_PREFIX } from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";
import { deliverOutboxPush, type DeliverOutboxPushDeps } from "./deliverOutboxPush.js";

/**
 * Pushes one outbox row per job (OOC-51; the relay enqueues them). Logs carry
 * the outbox id and the outcome, never the recipient, the endpoint or the
 * words (CLAUDE.md §6).
 */
export function startSendPushWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: Omit<DeliverOutboxPushDeps, "onDeviceFailed">,
): Worker<SendPushPayload> {
  return new Worker<SendPushPayload>(
    SEND_PUSH_QUEUE,
    async (job) => {
      const { outboxId } = SendPushPayloadSchema.parse(job.data);
      const outcome = await deliverOutboxPush(outboxId, {
        ...deps,
        onDeviceFailed: (info) => logger.warn(info, "push to one device failed"),
      });
      logger.info({ outboxId, outcome }, "send-push job done");
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 5 },
  );
}
