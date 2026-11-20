import type { Role } from "@ooc/domain";

/**
 * Who reads the reports (OOC-40) — the ledger summed up — mirroring
 * `canBrowseReports` in apps/app permissions.ts: management, the analyst who
 * observes every area, and the two supervisors who answer for enrollments and
 * for teaching. Billing's own figure (what came in this ciclo) is on Payments;
 * sales and support answer one student at a time and do not take the
 * institution's totals; a teacher has a portal of their own.
 */
export const REPORT_READ_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
] as const satisfies readonly Role[];
