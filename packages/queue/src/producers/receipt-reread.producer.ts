import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_PREFIX } from "../prefix.js";
import { RECEIPT_REREAD_QUEUE, ReceiptRereadPayloadSchema, type ReceiptRereadPayload } from "../jobs/receipt-reread.job.js";
import { RECEIPT_EXTRACT_ATTEMPTS } from "./receipt-extract.producer.js";

/** A re-read is the same model call as level 1, so it gets the same level-1r
 * retries: the first attempt plus three, then the failure is recorded. */
export const RECEIPT_REREAD_ATTEMPTS = RECEIPT_EXTRACT_ATTEMPTS;

export function createReceiptRereadQueue(connection: ConnectionOptions): Queue<ReceiptRereadPayload> {
  return new Queue<ReceiptRereadPayload>(RECEIPT_REREAD_QUEUE, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: RECEIPT_REREAD_ATTEMPTS,
      // 15s, 30s, 60s — same as the extract queue.
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
}

/** Job id derived from the request row, so the relay can offer it on every
 * sweep until the row is answered — one request, one model call. */
export async function enqueueReceiptReread(
  queue: Queue<ReceiptRereadPayload>,
  payload: ReceiptRereadPayload,
): Promise<void> {
  const parsed = ReceiptRereadPayloadSchema.parse(payload);
  await queue.add(RECEIPT_REREAD_QUEUE, parsed, { jobId: `receipt-reread-${parsed.rereadId}` });
}
