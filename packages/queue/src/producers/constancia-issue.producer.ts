import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { CONSTANCIA_ISSUE_EVERY_MS, CONSTANCIA_ISSUE_QUEUE } from "../jobs/constancia-issue.job.js";

export function createConstanciaIssueQueue(connection: ConnectionOptions): Queue {
  return new Queue(CONSTANCIA_ISSUE_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleConstanciaIssue(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    CONSTANCIA_ISSUE_QUEUE,
    { every: CONSTANCIA_ISSUE_EVERY_MS },
    { name: CONSTANCIA_ISSUE_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}
