export const FREEZE_REENGAGEMENT_QUEUE = "freeze-reengagement";

/**
 * How often the frozen enrollments are looked at for their 1, 3 and 6 month
 * re-engagement e-mails (OOC-84). The milestones are months apart; six hours
 * is plenty, and a tick with nothing due is one indexed read.
 */
export const FREEZE_REENGAGEMENT_EVERY_MS = 6 * 60 * 60 * 1000;
