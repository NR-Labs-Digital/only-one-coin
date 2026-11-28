import { z } from "zod";

export const SEND_PUSH_QUEUE = "send-push";

/**
 * Only a pointer to the `outbox` row (OOC-51), like the send-email job: the
 * row says what to push and whether it already went, and the recipient and
 * the words never reach Redis (CLAUDE.md §6).
 */
export const SendPushPayloadSchema = z.object({
  outboxId: z.string().uuid(),
});

export type SendPushPayload = z.infer<typeof SendPushPayloadSchema>;
