import { z } from "zod";

export const RECEIPT_REREAD_QUEUE = "receipt-reread";

/** Only a pointer to the `receipt_rereads` row — same as the extract job, the
 * image stays in the bucket and the reading goes to Postgres, never Redis. */
export const ReceiptRereadPayloadSchema = z.object({
  rereadId: z.string().uuid(),
});

export type ReceiptRereadPayload = z.infer<typeof ReceiptRereadPayloadSchema>;
