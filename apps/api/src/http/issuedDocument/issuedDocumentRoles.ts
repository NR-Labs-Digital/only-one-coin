import type { Role } from "@ooc/domain";
import { STUDENT_FILE_ROLES } from "@/http/student/studentRoles.js";

/**
 * Who confirms a certificate batch (OOC-33): coordination — management, the
 * enrollment supervision and the academic supervision (CLAUDE.md §8, "Emitem
 * documento"). The teacher, who may issue in their own class groups by that
 * rule, comes later (decision of 18/11/2026); `billing` never issues.
 */
export const CERTIFICATE_ISSUE_ROLES = [
  "master",
  "admin",
  "enrollment_supervisor",
  "academic_supervisor",
] as const satisfies readonly Role[];

/** Who reads a batch's preview: those, and the `analyst`, who reads and never acts. */
export const CERTIFICATE_READ_ROLES = [...CERTIFICATE_ISSUE_ROLES, "analyst"] as const satisfies readonly Role[];

/**
 * Who lists and downloads a student's issued documents in the panel: the
 * same three who keep the student file and its attached files (OOC-143) —
 * the documents live in the same list (OOC-148).
 */
export const ISSUED_DOCUMENT_STAFF_ROLES = STUDENT_FILE_ROLES;
