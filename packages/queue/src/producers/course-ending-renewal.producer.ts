import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { COURSE_ENDING_RENEWAL_EVERY_MS, COURSE_ENDING_RENEWAL_QUEUE } from "../jobs/course-ending-renewal.job.js";

export function createCourseEndingRenewalQueue(connection: ConnectionOptions): Queue {
  return new Queue(COURSE_ENDING_RENEWAL_QUEUE, { connection, prefix: QUEUE_PREFIX });
}

/** Idempotent: upserting the scheduler on every boot leaves exactly one. */
export async function scheduleCourseEndingRenewal(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    COURSE_ENDING_RENEWAL_QUEUE,
    { every: COURSE_ENDING_RENEWAL_EVERY_MS },
    { name: COURSE_ENDING_RENEWAL_QUEUE, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}
