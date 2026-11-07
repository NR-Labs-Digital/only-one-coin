import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { ATTACHMENT_SWEEP_EVERY_MS, ATTACHMENT_SWEEP_QUEUE } from "../jobs/attachment-sweep.job.js";

export function createAttachmentSweepQueue(connection: ConnectionOptions): Queue {
  return new Queue(ATTACHMENT_SWEEP_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleAttachmentSweep(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    ATTACHMENT_SWEEP_QUEUE,
    { every: ATTACHMENT_SWEEP_EVERY_MS },
    { name: ATTACHMENT_SWEEP_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}
