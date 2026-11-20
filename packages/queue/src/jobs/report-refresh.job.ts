export const REPORT_REFRESH_QUEUE = "report-refresh";

/**
 * When the reports' aggregation is rebuilt (OOC-40): every night at 04:00 in
 * Lima, the quietest hour of the checkout. Nightly, not live, as the contract
 * asks (Sessão 39) — the screen reads last night's figures and says so.
 */
export const REPORT_REFRESH_PATTERN = "0 4 * * *";
export const REPORT_REFRESH_TIMEZONE = "America/Lima";

/**
 * How old the last refresh may be at boot before one runs right away: a
 * deploy after a missed night, or the first boot with the tables empty. A
 * little over a day, so a normal night never triggers a second run.
 */
export const REPORT_REFRESH_STALE_AFTER_MS = 26 * 60 * 60_000;
