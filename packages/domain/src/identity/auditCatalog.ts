/*
 * What every `audit_log` action means to a reader (OOC-122) — one copy, read by
 * `apps/api` (the general log's filters, and which record an entry points at)
 * and by `apps/app` (the screen's labels, through the
 * `@ooc/domain/audit-catalog` subpath).
 *
 * Imported raw by the Next.js build, so it stays self-contained: no
 * dependency, no relative import.
 *
 * The stored action is dotted and says where the write came from
 * (`catalog.class_group.status_changed`); the screen gets the `key`, a closed
 * vocabulary it translates (CLAUDE.md §4). An action missing here still
 * lists, as `unknown` — never as its code — and `auditCatalog.test.ts` fails
 * the build when a usecase writes one, so the gap does not survive review.
 */

/** What an entry is about — the log's entity filter, and the link's target. */
export const AUDIT_ENTITIES = [
  "student",
  "payment",
  "class_group",
  "course",
  "academic_period",
  "teacher",
  "staff",
  "platform",
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/**
 * Where the record an entry is about lives, as the entry stores it:
 *
 * - `target` — `target_id` is that record's id.
 * - `metadata_student` / `metadata_class_group` — the id travels in
 *   `metadata.studentId` / `metadata.classGroupId` (the target is a seat or a
 *   waitlist row, which has no page of its own).
 * - `student_account` — `target_id` is the student's portal account
 *   (`"user".id`); the file is the student whose `user_id` it is.
 * - `plan` — `target_id` is a plan; the page is its course.
 * - `catalog_kind` — retire and restore name any catalog entry, and
 *   `metadata.kind` says which (`CatalogEntryKind`).
 * - `none` — nothing with a page: an invite, a setting, a whole directory.
 */
export type AuditSubject =
  | "target"
  | "metadata_student"
  | "metadata_class_group"
  | "student_account"
  | "plan"
  | "catalog_kind"
  | "none";

interface AuditActionEntry {
  key: string;
  /** Null only with `catalog_kind`, where the entry itself says. */
  entity: AuditEntity | null;
  subject: AuditSubject;
}

/**
 * The columns of `platform_settings`, each its own audit action
 * (`platform_settings.<column>`). Mirrors `PLATFORM_SETTING_COLUMNS` — the
 * test holds the two together, since this file may not import it.
 */
export const AUDITED_PLATFORM_SETTINGS = [
  "checkout_hold_minutes",
  "receipt_amount_tolerance_cents",
  "receipt_reject_below_percent",
  "review_window_days",
  "ocr_low_confidence_percent",
  "passing_grade",
  "certificate_deadline_business_days",
  "constancia_fee_cents",
  "contract_alert_days",
] as const;

const PLATFORM_SETTING_ACTIONS = Object.fromEntries(
  AUDITED_PLATFORM_SETTINGS.map((column) => [
    `platform_settings.${column}`,
    { key: "platform_setting_updated", entity: "platform", subject: "none" },
  ]),
) as Record<`platform_settings.${(typeof AUDITED_PLATFORM_SETTINGS)[number]}`, AuditActionEntry>;

export const AUDIT_ACTIONS = {
  "student.registered": { key: "student_registered", entity: "student", subject: "target" },
  "student.updated": { key: "student_updated", entity: "student", subject: "target" },
  "student.guardian_added": { key: "guardian_added", entity: "student", subject: "target" },
  "student.guardian_updated": { key: "guardian_updated", entity: "student", subject: "target" },
  "student.directory_exported": { key: "student_directory_exported", entity: "student", subject: "none" },
  "enrollment.created": { key: "enrollment_created", entity: "student", subject: "metadata_student" },
  "portal_access.created": { key: "portal_access_created", entity: "student", subject: "target" },
  "portal_access.issued": { key: "portal_access_issued", entity: "student", subject: "target" },
  "portal_access.email_conflict": { key: "portal_access_email_conflict", entity: "student", subject: "target" },
  "portal.password_set": { key: "portal_password_set", entity: "student", subject: "student_account" },
  "portal.password_reset_requested": {
    key: "portal_password_reset_requested",
    entity: "student",
    subject: "student_account",
  },

  "payment.approved": { key: "payment_approved", entity: "payment", subject: "target" },
  "payment.rejected": { key: "payment_rejected", entity: "payment", subject: "target" },
  "payment.receipt_viewed": { key: "receipt_viewed", entity: "payment", subject: "target" },
  "payment.receipt_reread_requested": { key: "receipt_reread_requested", entity: "payment", subject: "target" },

  "catalog.class_group.created": { key: "class_group_created", entity: "class_group", subject: "target" },
  "catalog.class_group.updated": { key: "class_group_updated", entity: "class_group", subject: "target" },
  "catalog.class_group.status_changed": {
    key: "class_group_status_changed",
    entity: "class_group",
    subject: "target",
  },
  "catalog.waitlist.joined": { key: "waitlist_joined", entity: "class_group", subject: "metadata_class_group" },
  "catalog.waitlist.left": { key: "waitlist_left", entity: "class_group", subject: "metadata_class_group" },

  "catalog.course.created": { key: "course_created", entity: "course", subject: "target" },
  "catalog.course.updated": { key: "course_updated", entity: "course", subject: "target" },
  "catalog.plan.created": { key: "plan_created", entity: "course", subject: "plan" },
  "catalog.plan.renamed": { key: "plan_renamed", entity: "course", subject: "plan" },
  "catalog.plan_price.scheduled": { key: "plan_price_scheduled", entity: "course", subject: "plan" },

  "catalog.academic_period.created": { key: "period_created", entity: "academic_period", subject: "target" },
  "catalog.academic_period.updated": { key: "period_updated", entity: "academic_period", subject: "target" },
  "catalog.academic_period.duplicated": {
    key: "period_duplicated",
    entity: "academic_period",
    subject: "target",
  },

  "catalog.retired": { key: "catalog_retired", entity: null, subject: "catalog_kind" },
  "catalog.restored": { key: "catalog_restored", entity: null, subject: "catalog_kind" },

  "teacher.registered": { key: "teacher_registered", entity: "teacher", subject: "target" },
  "teacher.updated": { key: "teacher_updated", entity: "teacher", subject: "target" },
  "teacher.availability_updated": { key: "teacher_availability_updated", entity: "teacher", subject: "target" },
  "teacher.left_roster": { key: "teacher_left_roster", entity: "teacher", subject: "target" },
  "teacher.rejoined_roster": { key: "teacher_rejoined_roster", entity: "teacher", subject: "target" },
  // Written until OOC-124 removed filing; old entries still list.
  "teacher.contract_filed": { key: "teacher_contract_filed", entity: "teacher", subject: "target" },
  "teacher.contract_viewed": { key: "teacher_contract_viewed", entity: "teacher", subject: "target" },
  "teacher_contract.generated": { key: "teacher_contract_generated", entity: "teacher", subject: "target" },
  "teacher_contract.regenerated": { key: "teacher_contract_regenerated", entity: "teacher", subject: "target" },

  "role.promote": { key: "role_changed", entity: "staff", subject: "target" },
  "staff.invite_created": { key: "staff_invite_created", entity: "staff", subject: "none" },
  "staff.invite_renewed": { key: "staff_invite_renewed", entity: "staff", subject: "none" },
  "staff.invite_cancelled": { key: "staff_invite_cancelled", entity: "staff", subject: "none" },
  "staff.invite_completed": { key: "staff_invite_completed", entity: "staff", subject: "target" },
  "staff.access_removed": { key: "staff_access_removed", entity: "staff", subject: "target" },
  "staff.access_restored": { key: "staff_access_restored", entity: "staff", subject: "target" },
  "staff.password_changed": { key: "staff_password_changed", entity: "staff", subject: "target" },
  "staff.password_reset_created": { key: "staff_password_reset_created", entity: "staff", subject: "target" },
  "staff.password_reset_requested": { key: "staff_password_reset_requested", entity: "staff", subject: "target" },
  "staff.password_reset_completed": { key: "staff_password_reset_completed", entity: "staff", subject: "target" },
  "staff.mfa_enabled": { key: "staff_mfa_enabled", entity: "staff", subject: "target" },
  "staff.mfa_disabled": { key: "staff_mfa_disabled", entity: "staff", subject: "target" },
  "staff.mfa_recovery_codes_regenerated": {
    key: "staff_mfa_recovery_codes_regenerated",
    entity: "staff",
    subject: "target",
  },

  ...PLATFORM_SETTING_ACTIONS,
  "feature_flag.override": { key: "feature_flag_changed", entity: "platform", subject: "none" },
  "document_template.published": { key: "document_template_published", entity: "platform", subject: "none" },
  "audit_log.exported": { key: "audit_log_exported", entity: "platform", subject: "none" },
} as const satisfies Record<string, AuditActionEntry>;

export type AuditStoredAction = keyof typeof AUDIT_ACTIONS;

/** What the screen calls an entry. `unknown` is a stored action not catalogued here. */
export type AuditActionKey = (typeof AUDIT_ACTIONS)[AuditStoredAction]["key"] | "unknown";

/** Every key the action filter offers, in catalogue order, once each. */
export const AUDIT_ACTION_KEYS: readonly Exclude<AuditActionKey, "unknown">[] = [
  ...new Set(Object.values(AUDIT_ACTIONS).map((entry) => entry.key)),
];

/** The stored actions behind one screen key — the filter's `where action in (...)`. */
export function storedActionsOf(key: AuditActionKey): AuditStoredAction[] {
  return (Object.keys(AUDIT_ACTIONS) as AuditStoredAction[]).filter((action) => AUDIT_ACTIONS[action].key === key);
}

/** `CatalogEntryKind` → the entity a retired or restored entry is about. A plan is its course's. */
export const CATALOG_KIND_ENTITY = {
  academic_period: "academic_period",
  course: "course",
  plan: "course",
  class_group: "class_group",
} as const satisfies Record<string, AuditEntity>;

/** The entity of one stored entry, or null when the catalogue does not know it. */
export function auditEntityOf(action: string, catalogKind: string | null): AuditEntity | null {
  const entry = (AUDIT_ACTIONS as Record<string, AuditActionEntry>)[action];
  if (!entry) return null;
  if (entry.subject !== "catalog_kind") return entry.entity;
  return (CATALOG_KIND_ENTITY as Record<string, AuditEntity>)[catalogKind ?? ""] ?? null;
}

/**
 * Field names as entries store them (`metadata.fields`, the entity's own
 * property names — CLAUDE.md §8 keeps names, never values) → the key the
 * screen labels them with. A name missing here is left off the screen rather
 * than shown raw; the test keeps every editable schema covered.
 */
export const AUDIT_FIELDS = {
  firstName: "first_name",
  lastName: "last_name",
  nationalIdType: "id_type",
  nationalId: "id_number",
  email: "email",
  phone: "phone",
  birthDate: "birth_date",
  country: "country",
  region: "region",
  city: "city",
  relationship: "relationship",
  nationality: "nationality",
  addressLine: "address",
  languages: "languages",
  availability: "availability",
  name: "name",
  language: "language",
  level: "level",
  summary: "summary",
  minAge: "min_age",
  modules: "modules",
  moduleMaterials: "module_materials",
  totalHours: "total_hours",
  certificateRule: "certificate_rule",
  allowsFreeze: "allows_freeze",
  allowsTransfer: "allows_transfer",
  landingKey: "landing_key",
  courseId: "course",
  code: "code",
  teacherId: "teacher",
  slots: "schedule",
  capacity: "capacity",
  startsOn: "starts_on",
  endsOn: "ends_on",
  enrollmentOpensAt: "enrollment_opens_at",
  enrollmentClosesAt: "enrollment_closes_at",
  checkout_hold_minutes: "checkout_hold_minutes",
  receipt_amount_tolerance_cents: "receipt_amount_tolerance_cents",
  receipt_reject_below_percent: "receipt_reject_below_percent",
  review_window_days: "review_window_days",
  ocr_low_confidence_percent: "ocr_low_confidence_percent",
  passing_grade: "passing_grade",
  certificate_deadline_business_days: "certificate_deadline_business_days",
  constancia_fee_cents: "constancia_fee_cents",
  contract_alert_days: "contract_alert_days",
} as const;

export type AuditField = (typeof AUDIT_FIELDS)[keyof typeof AUDIT_FIELDS];

/** Every field label key, once each. */
export const AUDIT_FIELD_KEYS: readonly AuditField[] = [...new Set(Object.values(AUDIT_FIELDS))];

/** The stored names an entry carries, as label keys — unknown names dropped. */
export function auditFieldsOf(raw: unknown): AuditField[] {
  if (!Array.isArray(raw)) return [];
  const fields = raw.flatMap((name) =>
    typeof name === "string" && name in AUDIT_FIELDS ? [AUDIT_FIELDS[name as keyof typeof AUDIT_FIELDS]] : [],
  );
  return [...new Set(fields)];
}
