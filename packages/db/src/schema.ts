import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Base schema — the columns every table starts from
// ---------------------------------------------------------------------------
// Which helper a table spreads is the whole statement this file makes about
// it: `...softDeletable()` says a row can leave the present,
// `createdAt: createdAt()` alone says the table is append-only.
//
// Lives here rather than in its own module because drizzle-kit loads this
// file through a CJS require that cannot follow a NodeNext ".js" specifier
// to its ".ts" source — a separate file breaks `db:generate`.

/**
 * The columns every table starts from, in one place instead of copied into
 * fifteen `pgTable` calls. Mirrors the domain side: `BaseModel` carries id +
 * timestamps, `SoftDeletableModel` adds `deletedAt`
 * (packages/domain/src/shared/base/).
 *
 * Every export is a **factory**, never a shared constant. A Drizzle column
 * builder carries the state of the column it is building, so handing the same
 * instance to two tables makes them share it — the kind of bug that surfaces
 * as a migration diff nobody asked for.
 */

// Postgres 18 (see compose.yml) generates uuidv7() natively — no extension
// needed, and it matches the uuid v7 format packages/domain already uses.
export const uuidPk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);

/** `timestamptz` always — UTC in the database, America/Lima only on render (CLAUDE.md §6). */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Null while the record still answers for itself. The only delete there is
 * (CLAUDE.md §6) — and on the tables migration 0011 locked, the only one
 * Postgres will allow.
 */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

/** For a table whose rows change over their life. */
export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * For a table whose rows can be retired. Spread it and the table has the whole
 * base: born, last changed, and retired-or-not.
 *
 * Deliberately not on every table. `plan_prices`, `consents` and `audit_log`
 * are append-only — a price in force is superseded by a new row rather than
 * edited (CLAUDE.md §5), a consent is the Ley 29733 proof, an audit entry
 * records that something happened and that does not stop being true. Giving
 * them a `deleted_at` would be handing out a way to hide what the platform
 * promises to keep.
 */
export const softDeletable = () => ({
  ...timestamps(),
  deletedAt: deletedAt(),
});

// Catalog is stable across sales periods — only class_groups (the class:
// schedule, seats, start date) gets recreated per academic_period
// (docs/ROADMAP.md Sessão 35, "duplicar período anterior... cria ~40
// turmas").
export const academicPeriods = pgTable("academic_periods", {
  id: uuidPk(),
  name: text("name").notNull(),
  startsOn: timestamp("starts_on", { withTimezone: true }).notNull(),
  endsOn: timestamp("ends_on", { withTimezone: true }).notNull(),
  ...softDeletable(),
});

// Each language track (Kids, Básico, Intermediário/Avançado...) is its own
// course, not a variant of plan within a single "Inglês" course — min_age
// is validated per course (docs/ROADMAP.md Sessão 21) and tracks have
// different minimum ages (docs/REGRAS-NEGOCIO.md §2).
export const courses = pgTable(
  "courses",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    minAge: integer("min_age").notNull(),
    // Catalog label ("A1", "Kids", "Básico a Avanzado") — data, not an enum
    // (apps/app/src/lib/enrollment/types.ts CatalogCourse.level). Default ''
    // only so the column can land aditively on existing rows; every course
    // the public catalog is meant to show should set a real one.
    level: text("level").notNull().default(""),
    modules: integer("modules").notNull().default(1),
    totalHours: integer("total_hours").notNull().default(0),
    ...softDeletable(),
  },
  (table) => [
    check("courses_min_age_check", sql`${table.minAge} > 0`),
    check("courses_modules_check", sql`${table.modules} > 0`),
    check("courses_total_hours_check", sql`${table.totalHours} >= 0`),
  ],
);

// A plan varies package/pricing shape within the same course (e.g. "Plano
// Básico" per module vs. "Plano Completo" of the same Inglês Básico).
export const plans = pgTable(
  "plans",
  {
    id: uuidPk(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ...softDeletable(),
  },
  (table) => [index("plans_course_id_idx").on(table.courseId)],
);

// Append-only: price is versioned, never edited (CLAUDE.md §5) — correcting
// a price is always a new row, never an UPDATE. The current price for a
// plan is the row with the greatest valid_from <= now(); "price in effect
// on date X" is the same query with X instead of now().
export const planPrices = pgTable(
  "plan_prices",
  {
    id: uuidPk(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    check("plan_prices_amount_cents_check", sql`${table.amountCents} > 0`),
    index("plan_prices_plan_id_valid_from_idx").on(
      table.planId,
      table.validFrom,
    ),
  ],
);

// The live instance of a course for one academic_period: schedule, seats,
// start date. Which plan/price a student bought is an attribute of the
// enrollment (Sessão 6), not of the class_group — students on different
// plans of the same course attend the same class_group.
//
// status enum matches ClassGroupStatus in the backoffice mock
// (apps/app/src/lib/backoffice/types.ts) — enrolling → in_progress →
// finished | closed.
export const classGroups = pgTable(
  "class_groups",
  {
    id: uuidPk(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    academicPeriodId: uuid("academic_period_id")
      .notNull()
      .references(() => academicPeriods.id, { onDelete: "restrict" }),
    schedule: text("schedule").notNull(),
    // Structured weekly slots (apps/app/src/lib/enrollment/types.ts
    // WeeklySlot[]) — added beside `schedule` rather than replacing it
    // (CLAUDE.md §7, migrations are additive; expand/contract is a separate
    // step). Default '[]' only for existing rows to land on; every class
    // group the public catalog is meant to show should carry real slots.
    slots: jsonb("slots").notNull().default([]),
    // Printed on paperwork, never shown in the public checkout itself
    // (CatalogClassGroup.code doc comment) — carried for the backoffice
    // side. Default '' only so the column can land aditively.
    code: text("code").notNull().default(""),
    // Plain text, not a `teachers` FK — there is no `teachers` table yet
    // (docs/ROADMAP.md Sessão 36). Denormalized placeholder until then.
    teacherName: text("teacher_name").notNull().default(""),
    startsOn: timestamp("starts_on", { withTimezone: true }).notNull(),
    // A class group can end before its academic_period does (a 4-module
    // course inside a longer sales period) — CatalogClassGroup.endDate on
    // the public catalog needs its own date, not the period's.
    endsOn: timestamp("ends_on", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").notNull().default(0),
    status: text("status").notNull().default("enrolling"),
    ...softDeletable(),
  },
  (table) => [
    check("class_groups_capacity_check", sql`${table.capacity} > 0`),
    check(
      "class_groups_seats_taken_check",
      sql`${table.seatsTaken} >= 0 and ${table.seatsTaken} <= ${table.capacity}`,
    ),
    // Matches apps/app/src/lib/backoffice/types.ts ClassGroupStatus exactly
    // — that vocabulary already exists and is exercised by the backoffice
    // mock; no reason to invent a different one and translate at the API
    // boundary (CLAUDE.md §1, class_groups.status was flagged provisional
    // in the original migration, resolved here before anything shipped).
    check(
      "class_groups_status_check",
      sql`${table.status} in ('enrolling', 'in_progress', 'finished', 'closed')`,
    ),
    index("class_groups_course_id_idx").on(table.courseId),
    index("class_groups_academic_period_id_idx").on(table.academicPeriodId),
  ],
);

// national_id_type is shared by students, guardians and (later) teachers —
// same union everywhere a Peruvian identity document is recorded.
const nationalIdTypeCheck = (columnName: string) =>
  sql.raw(`${columnName} in ('DNI', 'CE', 'passport')`);

// Status (active/under_review/inactive) is derived from enrollments, not a
// stored column — enrollments don't exist yet (Sessão 6), and there is
// nothing to derive from until they do (apps/app/src/lib/backoffice/types.ts,
// StudentStatus: "Derived, not a stored column").
//
// No user_id here: portal credentials are issued only after an enrollment is
// approved (CLAUDE.md §1, "aprovado: recebe credenciais") — out of scope for
// a manual backoffice registration, which never approves anything by itself.
export const students = pgTable(
  "students",
  {
    id: uuidPk(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    nationalIdType: text("national_id_type").notNull(),
    nationalId: text("national_id").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    birthDate: timestamp("birth_date", { withTimezone: true }).notNull(),
    // ISO 3166-1 alpha-2.
    country: text("country").notNull(),
    // First-level division ("departamento" in Peru). Null outside it.
    region: text("region"),
    city: text("city").notNull(),
    ...softDeletable(),
    // Soft delete only — no DELETE grant on students (CLAUDE.md §6).
  },
  (table) => [
    check("students_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
    index("students_national_id_type_national_id_idx").on(
      table.nationalIdType,
      table.nationalId,
    ),
    // Trigram GIN indexes back "busca por nome/DNI/telefone" (docs/ROADMAP.md
    // Sessão 5) — pg_trgm enabled in migrations/0003_enable_pg_trgm.sql,
    // which must apply before this migration.
    index("students_full_name_trgm_idx").using(
      "gin",
      sql`(${table.firstName} || ' ' || ${table.lastName}) gin_trgm_ops`,
    ),
    index("students_national_id_trgm_idx").using(
      "gin",
      sql`${table.nationalId} gin_trgm_ops`,
    ),
    index("students_phone_trgm_idx").using(
      "gin",
      sql`${table.phone} gin_trgm_ops`,
    ),
    // Backs cursor pagination on the no-`q` directory listing
    // (ListStudentsQuery) — `id` (uuidv7, itself time-ordered) breaks ties
    // on `created_at`, which a bulk import can produce many of in the same
    // statement-second.
    index("students_created_at_id_idx").on(table.createdAt, table.id),
  ],
);

// One guardian per student, optional unless the student is a minor
// (CLAUDE.md §1) — enforced in the application layer (birth_date isn't known
// to be "under 18" at the database level), not here. 1:1 via a unique FK,
// matching apps/app/src/lib/backoffice/types.ts StudentDetail.guardian being
// a single nullable object, never a list.
export const guardians = pgTable(
  "guardians",
  {
    id: uuidPk(),
    studentId: uuid("student_id")
      .notNull()
      .unique()
      .references(() => students.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    relationship: text("relationship").notNull(),
    nationalIdType: text("national_id_type").notNull(),
    nationalId: text("national_id").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    ...softDeletable(),
  },
  (table) => [
    check(
      "guardians_relationship_check",
      sql`"relationship" in ('mother', 'father', 'legal_guardian')`,
    ),
    check("guardians_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
  ],
);

// Ley 29733 consent — append-only, never edited (same pattern as
// plan_prices): the guardian is the one who accepts, with a timestamp, the
// text version and their IP (CLAUDE.md §1, §8). A guardian row is created
// with consent pending — zero rows here means pending; the current consent
// is the most recent row. Kept out of `guardians` itself because "quem
// aceita é o apoderado" is a fact about an event, not an editable field.
export const consents = pgTable(
  "consents",
  {
    id: uuidPk(),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardians.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    ip: text("ip").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("consents_guardian_id_accepted_at_idx").on(
      table.guardianId,
      table.acceptedAt,
    ),
  ],
);

// Seat lifecycle (CLAUDE.md §5: reserved → confirmed → released) lives here,
// not on class_groups — the incremented/decremented seats_taken counter is
// what class_groups tracks. `status` shown to the student (under_review /
// active / completed / rejected, apps/app/src/lib/portal/types.ts
// EnrollmentStatus) is derived from seat_status + payment.status + grading —
// not stored, same treatment as students.status (StudentStatus).
//
// plan_price_id freezes the price in force at enrollment time (CLAUDE.md §5,
// "preço é versionado, nunca editado") — never re-resolved from the current
// plan_prices row afterwards.
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuidPk(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    planPriceId: uuid("plan_price_id")
      .notNull()
      .references(() => planPrices.id, { onDelete: "restrict" }),
    seatStatus: text("seat_status").notNull().default("reserved"),
    // Channel attribution (CLAUDE.md §5, "Origem da matrícula") — captured at
    // first checkout access and carried to submit; the manual-enrollment path
    // (CreateManualEnrollmentUseCase) and the legacy import both count as
    // 'whatsapp', since both originate from a WhatsApp sale closed outside the
    // platform. Default 'web' only so the column lands additively on existing
    // rows written before this column existed.
    origin: text("origin").notNull().default("web"),
    ...softDeletable(),
  },
  (table) => [
    check(
      "enrollments_seat_status_check",
      sql`"seat_status" in ('reserved', 'confirmed', 'released')`,
    ),
    check("enrollments_origin_check", sql`"origin" in ('whatsapp', 'web')`),
    index("enrollments_student_id_idx").on(table.studentId),
    index("enrollments_class_group_id_idx").on(table.classGroupId),
  ],
);

// payments is agnostic of origin (CLAUDE.md §5) — scoped to enrollments only
// for now, since that is what both target forms (new-student-form.tsx,
// new-enrollment-form.tsx) need. Paid procedures (constancia and the rest of
// docs/REGRAS-NEGOCIO.md §5) share the same ladder per CLAUDE.md §1 but
// aren't in docs/ROADMAP.md Sessão 6's bullet list — deferred, not modeled
// here, rather than guessing their shape.
//
// idempotency_key is unique and required on every row (CLAUDE.md §5, "duplo
// POST de celular ruim é certeza") — this is the Sessão 6 "pronto quando"
// check: a duplicate payment insert must fail in the database, not just in
// application code.
export const payments = pgTable(
  "payments",
  {
    id: uuidPk(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    method: text("method").notNull(),
    // Required only when method is 'other' — the free text IS the label
    // (CLAUDE.md §4 glossary).
    methodDetail: text("method_detail"),
    amountCents: integer("amount_cents").notNull(),
    // Nullable: the public flow (Sessão 20+) only learns this once OCR reads
    // the receipt; the manual backoffice flow (NewEnrollmentInput) always
    // provides it upfront. Uniqueness against fraud lives on
    // payment_receipts, not here (see below).
    operationNumber: text("operation_number"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("payments_idempotency_key_uidx").on(table.idempotencyKey),
    check(
      "payments_status_check",
      sql`"status" in ('pending', 'under_review', 'approved', 'rejected')`,
    ),
    check(
      "payments_method_check",
      sql`"method" in ('yape', 'plin', 'bcp', 'interbank', 'other')`,
    ),
    check("payments_amount_cents_check", sql`${table.amountCents} > 0`),
    check(
      "payments_method_detail_required_check",
      sql`"method" <> 'other' or "method_detail" is not null`,
    ),
    index("payments_enrollment_id_idx").on(table.enrollmentId),
  ],
);

// Extraction data lives here, never on payments (CLAUDE.md §5). One row per
// uploaded receipt image — a payment can carry more than one over time (a
// rejected receipt gets replaced), so this is 1:N off payments, not 1:1.
//
// image_phash and operation_number each get a partial unique index (null
// allowed, but no two non-null values may repeat) — the antifraude defense
// against the same receipt cropped and resent (CLAUDE.md §5). tier /
// model_name / model_version / extracted_fields mirror the columns CLAUDE.md
// §5 requires ("gravar tier, model_name, model_version e confiança por campo
// em toda extração") even though no worker fills them yet — packages/ocr and
// the worker are Sessão 26+, out of scope here. extracted_fields is the
// per-field {field, value, confidence} array as JSON rather than a side
// table, since it is written once by the worker and never queried by field.
export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: uuidPk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    imagePhash: text("image_phash"),
    operationNumber: text("operation_number"),
    amountCents: integer("amount_cents"),
    tier: integer("tier"),
    modelName: text("model_name"),
    modelVersion: text("model_version"),
    extractedFields: jsonb("extracted_fields"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("payment_receipts_image_phash_uidx")
      .on(table.imagePhash)
      .where(sql`${table.imagePhash} is not null`),
    uniqueIndex("payment_receipts_operation_number_uidx")
      .on(table.operationNumber)
      .where(sql`${table.operationNumber} is not null`),
    index("payment_receipts_payment_id_idx").on(table.paymentId),
  ],
);

// One row per student waiting on a full class_group (Sessão 22, not built
// yet — this is just the queue table the roadmap bundles into Sessão 6).
// FIFO by created_at; the unique pair stops the same student from queuing
// twice for the same class group.
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuidPk(),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("waitlist_entries_class_group_id_student_id_uidx").on(
      table.classGroupId,
      table.studentId,
    ),
  ],
);

// Pending staff/backoffice invites (CLAUDE.md §8, "Equipe" — an admin opens the
// door, the person completes it themselves). `invitedBy`/`completedUserId` point
// at Better Auth's own "user".id, which is `text`, not `uuid` (0001_better_auth_core.sql)
// — Better Auth's tables aren't modeled in this schema (apps/api reads/writes them
// via raw SQL, mirroring apps/api/src/scripts/seed-admin.ts), so there is no FK here.
export const staffInvites = pgTable(
  "staff_invites",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: text("role").notNull(),
    // Deliberately plain text, not hashed — a product decision (not the safer
    // default): keeps "copiar el enlace" reusable for a pending invite at any
    // time, instead of needing a regenerate-on-resend flow. Trade-off: a DB read
    // or backup leak also hands out a live one-time sign-up link. Revisit if
    // that trade-off ever needs to change.
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by").notNull(),
    completedUserId: text("completed_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("staff_invites_token_uidx").on(table.token),
    uniqueIndex("staff_invites_pending_email_uidx")
      .on(table.email)
      .where(sql`${table.status} = 'pending'`),
    check(
      "staff_invites_role_check",
      sql`${table.role} in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'teacher', 'sales', 'support', 'billing')`,
    ),
    check("staff_invites_status_check", sql`${table.status} in ('pending', 'completed', 'cancelled')`),
  ],
);

// Append-only history of staff/role events (CLAUDE.md §8, "toda mudança de
// cargo → audit_log append-only"). No update/delete grant is set up for ANY
// table yet in this schema, so this matches the codebase's current actual
// enforcement level: append-only is a type-level guarantee on
// IAuditLogRepository (packages/domain/src/identity/ports/IAuditLogRepository.ts),
// which only exposes `append`.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuidPk(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_log_target_id_idx").on(table.targetId)],
);

// Pending password-reset links for an EXISTING panel account (CLAUDE.md §8 —
// staff forgetting their own password is expected, not an edge
// case). Same shape and same plain-text-token trade-off as `staffInvites`
// (see the comment there) — this is a sibling table, not a repurposed
// `staffInvites` row, because a reset has no firstName/lastName/role/email to
// carry: the account it targets already has all of that.
export const staffPasswordResets = pgTable(
  "staff_password_resets",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("staff_password_resets_token_uidx").on(table.token),
    uniqueIndex("staff_password_resets_pending_user_id_uidx")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "staff_password_resets_status_check",
      sql`${table.status} in ('pending', 'completed', 'cancelled')`,
    ),
  ],
);

// The panel's own switchboard: which sections of the platform are on the air
// (CLAUDE.md §5, "Feature flags"). One row per flag key declared in
// `apps/app/src/lib/feature-flags/registry.ts` — and only for the flags
// somebody actually moved: no row means "whatever the code declares", which is
// why this table starts and usually stays nearly empty.
//
// `key` is the primary key rather than a uuid: the identity of the row IS the
// flag it governs, an upsert is the natural write, and a flag can never have
// two conflicting rows. There is no FK and no CHECK on it — the list of flags
// lives in code, so a constraint here would demand a migration for every new
// flag; a row whose key is no longer in the registry is simply ignored by the
// resolver, which is the right answer for a flag that has been retired.
//
// `updatedBy` points at Better Auth's own "user".id (text, 0001) — the same
// no-FK situation as `staff_invites.invitedBy`. Who changed what, and when,
// is answered by `audit_log`, which every write here also appends to; this
// column only spares the screen a join to say "changed by X".
export const featureFlagOverrides = pgTable("feature_flag_overrides", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedBy: text("updated_by").notNull(),
  ...timestamps(),
});
