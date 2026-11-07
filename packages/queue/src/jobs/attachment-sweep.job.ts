export const ATTACHMENT_SWEEP_QUEUE = "attachment-sweep";

/**
 * How often uploads never confirmed are cleared (OOC-143). The upload target
 * dies in five minutes and a row is only stale after an hour
 * (`ATTACHMENT_PENDING_TTL_MS`), so a tick every ten minutes is plenty.
 */
export const ATTACHMENT_SWEEP_EVERY_MS = 10 * 60_000;
