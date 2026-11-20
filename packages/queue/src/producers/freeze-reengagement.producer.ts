import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { FREEZE_REENGAGEMENT_EVERY_MS, FREEZE_REENGAGEMENT_QUEUE } from "../jobs/freeze-reengagement.job.js";

export function createFreezeReengagementQueue(connection: ConnectionOptions): Queue {
  return new Queue(FREEZE_REENGAGEMENT_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleFreezeReengagement(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    FREEZE_REENGAGEMENT_QUEUE,
    { every: FREEZE_REENGAGEMENT_EVERY_MS },
    { name: FREEZE_REENGAGEMENT_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}
