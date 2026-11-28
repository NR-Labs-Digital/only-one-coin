import { Worker, type ConnectionOptions, type Queue } from "bullmq";
import {
  OUTBOX_RELAY_QUEUE,
  enqueueSendEmail,
  enqueueSendPush,
  type SendEmailPayload,
  type SendPushPayload,
  QUEUE_PREFIX,
} from "@ooc/queue";
import type { FastifyBaseLogger } from "fastify";
import type { IOutboxStore } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import type { IPushOutboxStore } from "@/infra/persistence/notification/DrizzlePushRepository.js";

/** Rows offered per sweep. At the peak (~24k e-mails/month, docs/
 * ARCHITECTURE.md) that is orders of magnitude above what accumulates in
 * one 5 s tick. */
const RELAY_BATCH = 200;

/**
 * The bridge from Postgres to the queue: every tick (scheduled by
 * `scheduleOutboxRelay`) it offers each pending outbox row to the send-email
 * queue. It keeps nothing of its own — the job id is derived from the row
 * (`enqueueSendEmail`), so offering a row that already has a job is a no-op,
 * and a row whose job was lost (a crash between commit and enqueue, a Redis
 * flush) is simply offered again on the next tick.
 *
 * With push on (OOC-51), the same tick offers the rows still waiting for a
 * push to the send-push queue — the e-mail and the push of a row each go
 * their own way, and neither waits for the other.
 */
export function startOutboxRelayWorker(
  connection: ConnectionOptions,
  logger: FastifyBaseLogger,
  deps: {
    store: IOutboxStore;
    sendEmailQueue: Queue<SendEmailPayload>;
    push: { store: IPushOutboxStore; queue: Queue<SendPushPayload> } | null;
  },
): Worker {
  return new Worker(
    OUTBOX_RELAY_QUEUE,
    async () => {
      const ids = await deps.store.listPendingIds(RELAY_BATCH);
      for (const outboxId of ids) {
        await enqueueSendEmail(deps.sendEmailQueue, { outboxId });
      }
      if (ids.length > 0) {
        logger.debug({ offered: ids.length }, "outbox relay offered pending rows");
      }

      if (deps.push) {
        const pushIds = await deps.push.store.listPendingPushIds(RELAY_BATCH);
        for (const outboxId of pushIds) {
          await enqueueSendPush(deps.push.queue, { outboxId });
        }
        if (pushIds.length > 0) {
          logger.debug({ offered: pushIds.length }, "outbox relay offered pending pushes");
        }
      }
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
}
