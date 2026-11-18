export const CONSTANCIA_ISSUE_QUEUE = "constancia-issue";

/**
 * How often paid constancia requests are issued (OOC-33). Approving the
 * payment in Pagos makes a request `paid`; a tick turns it into the document
 * and its e-mail. Thirty seconds is "right away" for whoever paid, and costs
 * one indexed read when there is nothing to do.
 */
export const CONSTANCIA_ISSUE_EVERY_MS = 30_000;
