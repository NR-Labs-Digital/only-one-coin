/*
 * What a staff account can do, as data (OOC-57, OOC-183).
 *
 * Every action of the panel is a permission here. A route declares the one it
 * needs (`.can("payments.settle")` on its RouteBuilder) instead of a list of
 * cargos, and each cargo — the ten of the board, and the ones administration
 * creates in Equipo — holds a set of them, stored in `staff_profile_permissions`
 * and edited on the screen. `defaultRoles` is what each board cargo held when
 * the permission was born: the seed of a fresh database, and of a permission
 * added later (the API grants it on boot to the cargos named here, once — what
 * administration took away afterwards does not come back).
 *
 * `grant` marks what the screen never hands out:
 * - `teacher` — the teacher portal, scoped to the account's own teacher file;
 *   only the teacher cargo holds it, and that cargo is not editable.
 * - `owners` — the platform owners' door, decided by the e-mail domain, never
 *   by a cargo (CLAUDE.md §5).
 * - `everyone` — an account's own password, language and second factor.
 *
 * Imported raw by the Next.js build (`@ooc/domain/permission-catalog`), so it
 * stays self-contained: no dependency, no relative import. Labels live in the
 * app's locale files, keyed by `area` and `key` (CLAUDE.md §4).
 */

/** The areas of the panel, in the order the screen shows them. */
export const PERMISSION_AREAS = [
  "students",
  "enrollments",
  "payments",
  "catalog",
  "grades",
  "teaching",
  "teachers",
  "emails",
  "reports",
  "settings",
  "team",
  "account",
] as const;

export type PermissionArea = (typeof PERMISSION_AREAS)[number];

/**
 * The cargos of the board (owner's decision, 07/09/2026), in the order the
 * screen shows them. Student and guardian are left out: their doors are the
 * portal's. Mirrors the staff side of `Role` — the API's build fails when the
 * two drift apart.
 */
export const BOARD_ROLES = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "academic_assistant",
  "teacher",
  "sales",
  "support",
  "billing",
] as const;

export type BoardRole = (typeof BOARD_ROLES)[number];

/**
 * Board cargos the screen never edits: `master` holds everything, always (it
 * is the owners' cargo), and `teacher` is the account of a teacher file, with
 * the portal scoped to it (OOC-79).
 */
export const LOCKED_ROLES = ["master", "teacher"] as const satisfies readonly BoardRole[];

export type PermissionGrant = "teacher" | "owners" | "everyone";

interface PermissionEntry {
  key: string;
  area: PermissionArea;
  defaultRoles: readonly BoardRole[];
  grant?: PermissionGrant;
}

export const PERMISSION_CATALOG = [
  // Students — the file, its documents and its attachments.
  { key: "students.view", area: "students", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "students.edit", area: "students", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "students.export", area: "students", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "students.portal_access", area: "students", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "students.revoke_document", area: "students", defaultRoles: ["master", "admin", "enrollment_supervisor"] },

  // Enrollments.
  { key: "enrollments.view", area: "enrollments", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "sales", "support"] },
  { key: "enrollments.create_manual", area: "enrollments", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "enrollments.move", area: "enrollments", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "enrollments.transfer", area: "enrollments", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "enrollments.freeze", area: "enrollments", defaultRoles: ["master", "admin", "enrollment_supervisor"] },

  // Payments.
  { key: "payments.view", area: "payments", defaultRoles: ["master", "admin", "analyst", "support", "billing"] },
  { key: "payments.view_receipt", area: "payments", defaultRoles: ["master", "admin", "analyst", "billing"] },
  // No route of its own: the student's phone on the receipt queue (OOC-146).
  { key: "payments.view_contact", area: "payments", defaultRoles: ["master", "admin", "support", "billing"] },
  { key: "payments.settle", area: "payments", defaultRoles: ["master", "admin", "billing"] },

  // Catalog — courses, periods and class groups.
  { key: "catalog.view", area: "catalog", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "academic_assistant", "sales", "support"] },
  // No route of its own: document, e-mail and phone on a class group's roster (OOC-71).
  { key: "catalog.roster_contact", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "catalog.courses_create", area: "catalog", defaultRoles: ["master", "admin"] },
  { key: "catalog.courses_edit", area: "catalog", defaultRoles: ["master", "admin"] },
  { key: "catalog.course_options", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "catalog.plan_prices", area: "catalog", defaultRoles: ["master", "admin"] },
  { key: "catalog.languages", area: "catalog", defaultRoles: ["master", "admin"] },
  { key: "catalog.periods", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "catalog.class_groups_edit", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor", "academic_supervisor"] },
  { key: "catalog.retire", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor"] },
  { key: "catalog.waitlist", area: "catalog", defaultRoles: ["master", "admin", "enrollment_supervisor"] },

  // Grades, progression and certificates, from the backoffice.
  { key: "grades.view", area: "grades", defaultRoles: ["master", "admin", "analyst", "academic_supervisor", "academic_assistant"] },
  { key: "grades.record", area: "grades", defaultRoles: ["master", "admin", "academic_supervisor"] },
  { key: "grades.review_register", area: "grades", defaultRoles: ["master", "admin", "academic_supervisor"] },
  { key: "grades.progression", area: "grades", defaultRoles: ["master", "admin", "enrollment_supervisor", "academic_supervisor"] },
  { key: "grades.certificates_preview", area: "grades", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor"] },
  { key: "grades.certificates_issue", area: "grades", defaultRoles: ["master", "admin", "enrollment_supervisor", "academic_supervisor"] },

  // The teacher's own portal — always scoped to their own class groups, so it
  // stays with the teacher cargo (`grant: "teacher"`).
  { key: "teaching.own_class_groups", area: "teaching", defaultRoles: ["teacher"], grant: "teacher" },
  { key: "teaching.own_grades", area: "teaching", defaultRoles: ["teacher"], grant: "teacher" },
  { key: "teaching.own_progression", area: "teaching", defaultRoles: ["teacher"], grant: "teacher" },
  { key: "teaching.onboarding", area: "teaching", defaultRoles: ["teacher"], grant: "teacher" },

  // Teachers — the roster and the contract.
  { key: "teachers.view", area: "teachers", defaultRoles: ["master", "admin", "analyst", "academic_supervisor", "academic_assistant"] },
  { key: "teachers.view_file", area: "teachers", defaultRoles: ["master", "admin", "analyst", "academic_supervisor", "academic_assistant", "teacher"] },
  { key: "teachers.register", area: "teachers", defaultRoles: ["master", "admin"] },
  { key: "teachers.edit", area: "teachers", defaultRoles: ["master", "admin", "academic_supervisor", "academic_assistant"] },
  { key: "teachers.contract_generate", area: "teachers", defaultRoles: ["master", "admin", "academic_supervisor", "academic_assistant"] },
  { key: "teachers.contract_download", area: "teachers", defaultRoles: ["master", "admin", "analyst", "academic_supervisor", "academic_assistant"] },

  // E-mails.
  { key: "emails.view", area: "emails", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor"] },
  { key: "emails.send", area: "emails", defaultRoles: ["master", "admin", "enrollment_supervisor"] },

  // Dashboard, reports and the audit log.
  { key: "reports.dashboard", area: "reports", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "academic_assistant", "sales", "support"] },
  { key: "reports.view", area: "reports", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor"] },
  { key: "reports.audit_log", area: "reports", defaultRoles: ["master", "admin", "analyst"] },
  { key: "reports.audit_log_export", area: "reports", defaultRoles: ["master", "admin", "analyst"] },

  // Settings.
  { key: "settings.read", area: "settings", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "academic_assistant", "teacher", "sales", "support", "billing"] },
  { key: "settings.edit", area: "settings", defaultRoles: ["master", "admin"] },
  { key: "settings.procedure_prices", area: "settings", defaultRoles: ["master", "admin"] },
  { key: "settings.document_templates", area: "settings", defaultRoles: ["master", "admin"] },
  { key: "settings.feature_flags", area: "settings", defaultRoles: [], grant: "owners" },

  // Team.
  { key: "team.view", area: "team", defaultRoles: ["master", "admin"] },
  { key: "team.permissions", area: "team", defaultRoles: ["master", "admin", "analyst"] },
  { key: "team.profiles", area: "team", defaultRoles: ["master", "admin"] },
  { key: "team.invite", area: "team", defaultRoles: ["master", "admin"] },
  { key: "team.change_role", area: "team", defaultRoles: ["master", "admin"] },
  { key: "team.access", area: "team", defaultRoles: ["master", "admin"] },
  { key: "team.retire", area: "team", defaultRoles: ["master", "admin"] },

  // Every account's own settings.
  { key: "account.self", area: "account", defaultRoles: ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "academic_assistant", "teacher", "sales", "support", "billing"], grant: "everyone" },
] as const satisfies readonly PermissionEntry[];

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((entry) => entry.key);

const BY_KEY = new Map<string, PermissionEntry>(PERMISSION_CATALOG.map((entry) => [entry.key, entry]));

export function isPermissionKey(value: string): value is PermissionKey {
  return BY_KEY.has(value);
}

/** Whether a cargo made or edited on the screen may hold this permission. */
export function isGrantable(key: PermissionKey): boolean {
  return BY_KEY.get(key)?.grant === undefined;
}

export function grantOf(key: PermissionKey): PermissionGrant | null {
  return BY_KEY.get(key)?.grant ?? null;
}

/** What a board cargo holds on a fresh database. `master` holds every permission a cargo can. */
export function defaultPermissionsOf(role: BoardRole): PermissionKey[] {
  return (PERMISSION_CATALOG as readonly PermissionEntry[]).filter((entry) =>
    role === "master"
      ? entry.grant === undefined || entry.grant === "everyone"
      : (entry.defaultRoles as readonly string[]).includes(role),
  ).map((entry) => entry.key as PermissionKey);
}

/** Permissions every staff account holds whatever its cargo. */
export const EVERYONE_PERMISSIONS: readonly PermissionKey[] = (PERMISSION_CATALOG as readonly PermissionEntry[])
  .filter((entry) => entry.grant === "everyone")
  .map((entry) => entry.key as PermissionKey);

/**
 * Permissions that move money, hand out access or change the platform's
 * rules. A cargo holding any of them must sign in with the second factor
 * (CLAUDE.md §8) — which, with the board's defaults, is exactly master, admin
 * and billing.
 */
export const MFA_SENSITIVE_PERMISSIONS = [
  "payments.settle",
  "catalog.plan_prices",
  "settings.edit",
  "settings.procedure_prices",
  "team.invite",
  "team.change_role",
  "team.access",
  "team.retire",
  "team.profiles",
] as const satisfies readonly PermissionKey[];

export function holdsMfaSensitive(permissions: Iterable<string>): boolean {
  for (const key of permissions) {
    if ((MFA_SENSITIVE_PERMISSIONS as readonly string[]).includes(key)) return true;
  }
  return false;
}

/**
 * A cargo as the screens see it. A board cargo has `role` and is named by the
 * locale; one created in Equipo has `name` (what administration typed) and
 * its accounts carry the `custom` role.
 */
export interface StaffProfileView {
  id: string;
  role: BoardRole | null;
  name: string | null;
  permissions: PermissionKey[];
  /** Master and teacher — never edited on the screen. */
  locked: boolean;
  mfaRequired: boolean;
  /** Accounts on this cargo, and invites still waiting on the person. */
  members: number;
}
