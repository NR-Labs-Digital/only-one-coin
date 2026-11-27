import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { SEND_PUSH_QUEUE, SendPushPayloadSchema, type SendPushPayload } from "../jobs/send-push.job.js";

/**
 * One try per row: the worker claims the row before sending, so a retry would
 * find it taken anyway — a push is at most once (apps/api/CLAUDE.md,
 * "Notificações"). Failed jobs stay a week for inspection.
 */
export function createSendPushQueue(connection: ConnectionOptions): Queue<SendPushPayload> {
  return new Queue<SendPushPayload>(SEND_PUSH_QUEUE, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
}

/** The job id is derived from the outbox row, so offering it again is a no-op. */
export async function enqueueSendPush(queue: Queue<SendPushPayload>, payload: SendPushPayload): Promise<void> {
  const parsed = SendPushPayloadSchema.parse(payload);
  await queue.add(SEND_PUSH_QUEUE, parsed, { jobId: `push-${parsed.outboxId}` });
}
