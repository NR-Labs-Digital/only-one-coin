import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
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
    // One material link per module, in module order (OOC-94). Empty on a course
    // written before it — that course warns, it does not lock — so no CHECK on
    // the length: "empty, or exactly `modules` valid links" is the domain's rule.
    moduleMaterials: text("module_materials").array().notNull().default(sql`'{}'::text[]`),
    totalHours: integer("total_hours").notNull().default(0),
    // What the course is, in the student's words — the portal shows it under
    // "Sobre el curso". Default '' only so the column lands aditively.
    summary: text("summary").notNull().default(""),
    // How the certificate is earned (docs/REGRAS-NEGOCIO.md §6). Config, never
    // inferred from the course name (CLAUDE.md §1).
    certificateRule: text("certificate_rule").notNull().default("automatic"),
    // Which paid procedures the course offers (docs/REGRAS-NEGOCIO.md §5).
    allowsFreeze: boolean("allows_freeze").notNull().default(true),
    allowsTransfer: boolean("allows_transfer").notNull().default(false),
    // Which landing page's enroll button opens the checkout on this course
    // (OOC-117) — a key from LANDING_COURSE_KEYS (@ooc/domain), not an id: the
    // landing is static and cannot know a UUID minted per environment. Null
    // is a course no landing page links to.
    landingKey: text("landing_key"),
    ...softDeletable(),
  },
  (table) => [
    // One live course per landing page; a retired course lets go of its key.
    uniqueIndex("courses_landing_key_live_uidx")
      .on(table.landingKey)
      .where(sql`${table.landingKey} is not null and ${table.deletedAt} is null`),
    check(
      "courses_certificate_rule_check",
      sql`${table.certificateRule} in ('automatic', 'exam_required')`,
    ),
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
// finished | closed, plus 'draft' (OOC-35) before enrolling: a class group
// that exists but is not on sale and holds no seat.
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
    // Denormalized teacher name, kept until the contract step (CLAUDE.md §7);
    // `teacher_id` below is the real link.
    teacherName: text("teacher_name").notNull().default(""),
    // The teacher running it (OOC-77). Nullable: a class group can open before
    // anybody is allocated, and every row written before this column has none.
    // `teacher_name` stays until the contract step (CLAUDE.md §7).
    teacherId: uuid("teacher_id").references((): AnyPgColumn => teachers.id, { onDelete: "restrict" }),
    // The Google Classroom coordination pastes for the class group (OOC-98),
    // read by its teacher and its confirmed students. Null until somebody
    // pastes it; the host rule lives in the domain, like module materials.
    classroomUrl: text("classroom_url"),
    // Null only while the class group is a draft (OOC-35): a duplicated class group starts without dates on purpose.
    startsOn: timestamp("starts_on", { withTimezone: true }),
    // A class group can end before its academic_period does (a 4-module
    // course inside a longer sales period) — CatalogClassGroup.endDate on
    // the public catalog needs its own date, not the period's.
    // Null only while the class group is a draft (OOC-35): a duplicated class group starts without dates on purpose.
    endsOn: timestamp("ends_on", { withTimezone: true }),
    // Optional enrollment window (OOC-35). Null on either side = no limit on
    // that side; the class group sells while status = 'enrolling' and now is
    // inside the window.
    enrollmentOpensAt: timestamp("enrollment_opens_at", { withTimezone: true }),
    enrollmentClosesAt: timestamp("enrollment_closes_at", { withTimezone: true }),
    // The class group this one was copied from when a period was duplicated —
    // the trail, and what stops the same copy from running twice.
    sourceClassGroupId: uuid("source_class_group_id").references(
      (): AnyPgColumn => classGroups.id,
      { onDelete: "restrict" },
    ),
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
      sql`${table.status} in ('draft', 'enrolling', 'in_progress', 'finished', 'closed')`,
    ),
    check(
      "class_groups_dates_check",
      sql`${table.status} = 'draft' or (${table.startsOn} is not null and ${table.endsOn} is not null)`,
    ),
    check(
      "class_groups_enrollment_window_check",
      sql`${table.enrollmentOpensAt} is null or ${table.enrollmentClosesAt} is null or ${table.enrollmentOpensAt} < ${table.enrollmentClosesAt}`,
    ),
    index("class_groups_source_class_group_id_idx").on(table.sourceClassGroupId),
    index("class_groups_course_id_idx").on(table.courseId),
    index("class_groups_teacher_id_idx").on(table.teacherId),
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
// `user_id` links the file to its portal account (Better Auth's "user".id,
// text). Set when the first payment is approved (CLAUDE.md §1, reopened
// 05/10/2026) — not unique: two files of the same person (same normalized
// document, still not consolidated — CLAUDE.md §1, "Um documento, uma
// pessoa") point at the same account.
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
    userId: text("user_id"),
    ...softDeletable(),
    // Soft delete only — no DELETE grant on students (CLAUDE.md §6).
  },
  (table) => [
    check("students_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
    index("students_national_id_type_national_id_idx").on(
      table.nationalIdType,
      table.nationalId,
    ),
    index("students_user_id_idx").on(table.userId),
    // The portal sign-in by document (apps/api, PortalSignInRoute): matches
    // on the document normalized in SQL — the same rule as
    // `normalizeNationalId` — so a file written before OOC-64 (with dots or
    // dashes) still finds its account. Only files with an account are
    // searched, which keeps the index small.
    index("students_portal_national_id_idx")
      .on(table.nationalIdType, sql`regexp_replace(upper(${table.nationalId}), '[[:space:].-]', '', 'g')`)
      .where(sql`${table.userId} is not null`),
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
  () => [
    check(
      "guardians_relationship_check",
      sql`"relationship" in ('mother', 'father', 'legal_guardian')`,
    ),
    check("guardians_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
  ],
);

// ---------------------------------------------------------------------------
// Teachers (OOC-77)
// ---------------------------------------------------------------------------
// A teacher leaves the roster as `inactive`, never as a deleted row: whoever
// ran a class group and signed its grades is still pointed at by them. The
// physical DELETE is refused by the database (0025), as for students.
// `deleted_at` exists for a record created by mistake, not for leaving.
//
// `national_id` is stored normalized by the domain (student/fields.ts), so the
// unique index sits on the raw column. `user_id` is the panel account
// (Better Auth's "user".id, text) — its FK is hand-written in 0025, as in 0022.
export const teachers = pgTable(
  "teachers",
  {
    id: uuidPk(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    nationalIdType: text("national_id_type").notNull(),
    nationalId: text("national_id").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    // ISO 3166-1 alpha-2 — where they are from; a selling point in the catalog.
    nationality: text("nationality").notNull(),
    // ISO 3166-1 alpha-2 — where they live; the contract needs an address.
    country: text("country").notNull(),
    // First-level division ("departamento" in Peru). Null outside it.
    region: text("region"),
    city: text("city").notNull(),
    addressLine: text("address_line").notNull(),
    status: text("status").notNull().default("active"),
    userId: text("user_id"),
    ...softDeletable(),
  },
  (table) => [
    check("teachers_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
    check("teachers_status_check", sql`${table.status} in ('active', 'inactive')`),
    // The same normal form as normalizeNationalId (no spaces, dots or dashes,
    // upper case): the unique index sits on the raw column, so a value written
    // un-normalized would slip past it.
    check(
      "teachers_national_id_normalized_check",
      sql`${table.nationalId} = upper(regexp_replace(${table.nationalId}, '[[:space:].-]', '', 'g'))`,
    ),
    uniqueIndex("teachers_national_id_uidx")
      .on(table.nationalIdType, table.nationalId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("teachers_user_id_uidx").on(table.userId),
  ],
);

// The languages a teacher is cleared to run a class group in — the same text
// as `courses.language` (there is no languages table, CLAUDE.md §1). Rewritten
// as a set when the file is edited.
export const teacherLanguages = pgTable(
  "teacher_languages",
  {
    id: uuidPk(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "restrict" }),
    language: text("language").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("teacher_languages_teacher_id_language_uidx").on(table.teacherId, table.language)],
);

// Weekly windows a teacher is free in. `time`, not `timestamptz`: "Tuesday at
// 19:00" is a wall-clock time in America/Lima, the same thing as a class
// group's `slots` — there is no instant to put a zone on. The one documented
// exception to "timestamptz sempre" (packages/db/CLAUDE.md). Overlapping
// windows are refused by the domain; the database would need btree_gist.
export const teacherAvailability = pgTable(
  "teacher_availability",
  {
    id: uuidPk(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "restrict" }),
    weekday: text("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    ...timestamps(),
  },
  (table) => [
    check(
      "teacher_availability_weekday_check",
      sql`${table.weekday} in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')`,
    ),
    check("teacher_availability_time_range_check", sql`${table.startTime} < ${table.endTime}`),
    // Whole minutes only: the domain speaks HH:mm, so seconds would be lost on
    // the round-trip.
    check(
      "teacher_availability_whole_minutes_check",
      sql`extract(second from ${table.startTime}) = 0 and extract(second from ${table.endTime}) = 0`,
    ),
    uniqueIndex("teacher_availability_slot_uidx").on(table.teacherId, table.weekday, table.startTime),
  ],
);

// A teacher's contract period. Since OOC-124 a row is born when the contract
// is generated from the published template (`template_version_id`, so the
// same text can be printed again) — the signed copy is kept outside the
// platform. Rows filed before that (OOC-81) carry the uploaded PDF instead:
// `object_key`, `file_name` and `file_size_bytes` come together or not at
// all, and every row has a file or a template version (0036). "No contract"
// is no row. Append-only (0025 lock): correcting one is recording a new one.
// The current contract is the latest by `created_at`. `uploaded_by` is
// whoever recorded it — Better Auth's "user".id, FK hand-written in 0025; the
// name stays from the upload days (renaming is expand/contract).
export const teacherContracts = pgTable(
  "teacher_contracts",
  {
    id: uuidPk(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "restrict" }),
    objectKey: text("object_key"),
    fileName: text("file_name"),
    fileSizeBytes: integer("file_size_bytes"),
    templateVersionId: uuid("template_version_id"),
    startsOn: timestamp("starts_on", { withTimezone: true }).notNull(),
    endsOn: timestamp("ends_on", { withTimezone: true }).notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Named by hand: the generated name runs past Postgres' 63 characters.
    foreignKey({
      name: "teacher_contracts_template_version_id_fk",
      columns: [table.templateVersionId],
      foreignColumns: [documentTemplateVersions.id],
    }).onDelete("restrict"),
    uniqueIndex("teacher_contracts_object_key_uidx").on(table.objectKey),
    index("teacher_contracts_teacher_id_created_at_idx").on(table.teacherId, table.createdAt),
    check("teacher_contracts_file_size_check", sql`${table.fileSizeBytes} > 0`),
    check("teacher_contracts_period_check", sql`${table.startsOn} <= ${table.endsOn}`),
    check(
      "teacher_contracts_file_check",
      sql`(${table.objectKey} is null) = (${table.fileName} is null) and (${table.objectKey} is null) = (${table.fileSizeBytes} is null)`,
    ),
    check(
      "teacher_contracts_source_check",
      sql`${table.objectKey} is not null or ${table.templateVersionId} is not null`,
    ),
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
    // A confirmed, live seat per class group — Enrollments' default list and
    // the "active student" count (OOC-112).
    index("enrollments_confirmed_class_group_id_idx")
      .on(table.classGroupId)
      .where(sql`${table.seatStatus} = 'confirmed' and ${table.deletedAt} is null`),
  ],
);

// The checkout hold — the short clock of apps/api/CLAUDE.md "Dois relógios".
// A seat is taken from the class group the moment the public checkout settles
// on one, before anybody has typed a name: the person is about to leave for
// their banking app, and coming back to a full class group has no remedy.
// There is no student yet, so this cannot be an `enrollments` row; the hold
// lives here until the submit consumes it (the seat passes to the enrollment,
// never counted twice) or the sweep expires it (the seat goes back).
//
// active → consumed (the submit landed) | released (the checkout let go of
// it, e.g. picked another class group) | expired (the sweep). Released and
// expired are kept apart on purpose: the expiry rate in production is what
// decides whether the configured minutes change again
// (docs/MATRICULA-CHECKOUT.md §3).
//
// `expires_at` is stamped from the database clock at claim time, and every
// comparison against it uses the database clock too — the client's countdown
// is comfort, never authority.
//
// `id` is `gen_random_uuid()` (v4), not the uuidv7 every other table uses:
// the id is the only thing the anonymous checkout holds to consume or release
// this seat, and a time-ordered id is partly guessable.
//
// `origin` is the channel the checkout was entered through, carried here from
// first access and copied onto the enrollment by the submit — the submit
// never takes it from its own body.
//
// No `deleted_at`: `status` tells the row's whole life.
export const seatHolds = pgTable(
  "seat_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when the hold leaves `active`, whichever way it leaves.
    settledAt: timestamp("settled_at", { withTimezone: true }),
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (table) => [
    check("seat_holds_origin_check", sql`${table.origin} in ('whatsapp', 'web')`),
    check(
      "seat_holds_status_check",
      sql`${table.status} in ('active', 'consumed', 'released', 'expired')`,
    ),
    // A consumed hold always says which enrollment took its seat, and only a
    // consumed one does.
    check(
      "seat_holds_enrollment_check",
      sql`(${table.status} = 'consumed') = (${table.enrollmentId} is not null)`,
    ),
    check(
      "seat_holds_settled_check",
      sql`(${table.status} = 'active') = (${table.settledAt} is null)`,
    ),
    // The sweep's only query: active holds, soonest to expire first.
    index("seat_holds_active_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
    index("seat_holds_class_group_id_idx").on(table.classGroupId),
  ],
);

// The checkout's proof that the student's e-mail is theirs (spec
// 2026-10-07): a 6-digit code mailed to the address, tied to the seat hold —
// the only session an anonymous checkout has. The submit consumes a verified
// row for its own hold and the student's e-mail inside its transaction, or
// refuses; which enrollment consumed it is `seat_holds.enrollment_id`.
//
// `code_hash` is sha256(id + ":" + code). Six digits do not survive an offline
// brute force — the protection is the 10-minute expiry and the 5 attempts; the
// hash only keeps the code out of dumps and logs. `expires_at` is stamped and
// compared on the database clock. A new code for the same hold expires the
// pending ones (only the latest code works).
//
// No `deleted_at`: the timestamps tell the row's whole life.
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuidPk(),
    seatHoldId: uuid("seat_hold_id")
      .notNull()
      .references(() => seatHolds.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check("email_verifications_attempts_check", sql`${table.attempts} between 0 and 5`),
    // Consumed only once verified.
    check(
      "email_verifications_consumed_check",
      sql`${table.consumedAt} is null or ${table.verifiedAt} is not null`,
    ),
    // The cooldown and the send count, and the confirm's "newest for this hold".
    index("email_verifications_seat_hold_id_created_at_idx").on(table.seatHoldId, table.createdAt),
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
    // The decision, as data to read (OOC-112). `audit_log` stays the trail
    // and is still written in the same transaction; these columns are what
    // the ledger sorts and filters on without joining it. `decided_by` has a
    // hand-written FK to Better Auth's "user" (0027) and is null for rows
    // decided outside the panel (seed, legacy import). `rejection_reason` is
    // the reason code only — the reviewer's free-text note stays in the trail.
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("payments_idempotency_key_uidx").on(table.idempotencyKey),
    // Decided ⇔ dated: a settled payment always says when.
    check(
      "payments_decided_at_check",
      sql`("status" in ('approved', 'rejected')) = ("decided_at" is not null)`,
    ),
    check("payments_decided_by_check", sql`"decided_by" is null or "decided_at" is not null`),
    // Only a rejection carries a reason. Nullable on a rejection on purpose:
    // the legacy import's PAGOS ERRONEOS bucket has none to give.
    check(
      "payments_rejection_reason_check",
      sql`"rejection_reason" is null or ("status" = 'rejected' and "rejection_reason" in ('amount_mismatch', 'illegible', 'duplicate', 'not_a_receipt', 'other'))`,
    ),
    // The open queue — Payments' default list and the badge (OOC-112).
    index("payments_open_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('pending', 'under_review')`),
    check(
      "payments_status_check",
      sql`"status" in ('pending', 'under_review', 'approved', 'rejected')`,
    ),
    check(
      "payments_method_check",
      sql`"method" in ('yape', 'plin', 'bcp', 'interbank', 'other')`,
    ),
    check("payments_amount_cents_check", sql`${table.amountCents} > 0`),
    // The operation-number guard's lookup (OOC-22): one operation pays for
    // one enrollment, per method. The expression is the SQL mirror of
    // normalizeOperationNumber (packages/domain) and has to match
    // operationNumberKey in apps/api/.../operationNumberGuard.ts character
    // for character, or the planner stops using this index. Not unique yet —
    // legacy-imported rows may already repeat, the same expand/contract
    // reasoning as the students' national_id (CLAUDE.md §1); the guard takes
    // an advisory lock instead.
    index("payments_method_operation_key_idx")
      .on(table.method, sql`upper(regexp_replace(${table.operationNumber}, '[^A-Za-z0-9]', '', 'g'))`)
      .where(sql`${table.operationNumber} is not null`),
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
// image_phash had a unique index until OOC-22 (30/09/2026): two different
// Yape receipts for the same price hash identically — the only differences
// are text too small for a perceptual hash — so a unique index there refuses
// the second honest student. It is a plain index now; similarity is a
// screening signal for a human, never a constraint (apps/api/CLAUDE.md,
// "Antifraude do comprovante"). operation_number lost its unique index the
// same way in OOC-20: the operation-number guard is per payment method and
// lives on payments (OOC-22), and a global unique index on what the model
// *read* would fail the worker forever on the second receipt that honestly
// shows the same digits — a Plin and a BCP, or the replacement photo of the
// same payment.
//
// tier / model_name / model_version / extracted_fields are what CLAUDE.md
// requires on every extraction ("gravar tier, model_name, model_version e
// confiança por campo"). extracted_fields is the per-field
// {field, value, confidence} array as JSON rather than a side table, since
// it is written once by the worker and never queried by field. Since OOC-20
// the receipt-extract worker writes one row per (receipt upload, tier) — the
// unique index makes a redelivered job a no-op. A row with failure_reason
// set is an extraction that produced no fields (retries exhausted): written
// anyway, so the relay stops offering the receipt and a reviewer sees why it
// has no reading.
export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: uuidPk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    // Nullable only for rows that could predate OOC-20 — every extraction
    // names the upload whose processed image it read.
    receiptUploadId: uuid("receipt_upload_id").references(() => receiptUploads.id, { onDelete: "restrict" }),
    imagePhash: text("image_phash"),
    operationNumber: text("operation_number"),
    amountCents: integer("amount_cents"),
    tier: integer("tier"),
    modelName: text("model_name"),
    modelVersion: text("model_version"),
    extractedFields: jsonb("extracted_fields"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
  },
  (table) => [
    index("payment_receipts_image_phash_idx")
      .on(table.imagePhash)
      .where(sql`${table.imagePhash} is not null`),
    index("payment_receipts_operation_number_idx")
      .on(table.operationNumber)
      .where(sql`${table.operationNumber} is not null`),
    index("payment_receipts_payment_id_idx").on(table.paymentId),
    uniqueIndex("payment_receipts_receipt_upload_tier_uidx")
      .on(table.receiptUploadId, table.tier)
      .where(sql`${table.receiptUploadId} is not null`),
  ],
);

// The receipt image's file custody, scoped to the seat hold rather than the
// payment — at the point the checkout uploads a photo, the hold is the only
// server-minted id that exists (OOC-19; enrollment and payment are only born
// at submit, apps/api/CLAUDE.md "Upload"). `payment_id` is filled the same
// way `seat_holds.enrollment_id` is: null while the checkout is still being
// filled in, set once inside the submit transaction that consumes the hold.
//
// The row never holds the raw bytes — only where they live in the bucket.
// `object_key` is the upload the client PUT to (server-minted, unguessable,
// scoped by `seat_hold_id`); `processed_object_key` is filled by the
// normalize worker once it downscales/greyscales/strips EXIF and is the only
// version CLAUDE.md's 5-year retention rule keeps — the raw key is deleted
// from the bucket the moment the processed one lands, so this table always
// says which key is actually still in storage.
export const receiptUploads = pgTable(
  "receipt_uploads",
  {
    id: uuidPk(),
    seatHoldId: uuid("seat_hold_id")
      .notNull()
      .references(() => seatHolds.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "restrict" }),
    objectKey: text("object_key").notNull(),
    status: text("status").notNull().default("pending"),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    processedObjectKey: text("processed_object_key"),
    rejectionReason: text("rejection_reason"),
    // The receipt's fingerprint (OOC-22), written by the normalize worker
    // together with processed_object_key. sha256 is of the raw upload, so a
    // byte-identical resend is exact; the pHash is of the normalized image
    // (64 bits as a signed bigint — XOR and bit_count work on it in SQL),
    // and the crops are the same hash over sub-rectangles of it, so a
    // cropped resend still lands near one of them.
    imageSha256: text("image_sha256"),
    imagePhash: bigint("image_phash", { mode: "bigint" }),
    imagePhashCrops: bigint("image_phash_crops", { mode: "bigint" }).array(),
    // Software / capture / modify dates read from EXIF before the normalize
    // step strips it. Never GPS or device ids — only what a signal is built
    // from (ReceiptExifFacts).
    exifFacts: jsonb("exif_facts"),
    // Level 0 of the OCR ladder: the ReceiptFraudSignal[] the screening
    // found, stamped once. Null screened_at = not screened yet.
    fraudSignals: jsonb("fraud_signals"),
    screenedAt: timestamp("screened_at", { withTimezone: true }),
    // The receipt traffic light (OOC-21), stamped once after the screening
    // and the level-1 reading: 'approve' | 'review' | 'reject_suggested',
    // and `validation_detail` holds the reason and the numbers it was decided
    // with (ReceiptValidationDetail). Null validated_at = not validated yet.
    validationVerdict: text("validation_verdict"),
    validationDetail: jsonb("validation_detail"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("receipt_uploads_object_key_uidx").on(table.objectKey),
    check(
      "receipt_uploads_status_check",
      sql`${table.status} in ('pending', 'uploaded', 'processed', 'rejected')`,
    ),
    check(
      "receipt_uploads_processed_check",
      sql`(${table.status} = 'processed') = (${table.processedObjectKey} is not null)`,
    ),
    index("receipt_uploads_seat_hold_id_idx").on(table.seatHoldId),
    // The normalize relay's only query: uploads waiting to be picked up.
    index("receipt_uploads_uploaded_idx").on(table.createdAt).where(sql`${table.status} = 'uploaded'`),
    // The screening relay's only query: normalized, attached, not screened.
    index("receipt_uploads_screen_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'processed' and ${table.paymentId} is not null and ${table.screenedAt} is null`),
    index("receipt_uploads_image_sha256_idx").on(table.imageSha256).where(sql`${table.imageSha256} is not null`),
    check(
      "receipt_uploads_validation_verdict_check",
      sql`${table.validationVerdict} is null or ${table.validationVerdict} in ('approve', 'review', 'reject_suggested')`,
    ),
    check(
      "receipt_uploads_validation_stamp_check",
      sql`(${table.validationVerdict} is null) = (${table.validatedAt} is null)`,
    ),
    // The validation relay's query: screened, attached, not validated. The
    // level-1 reading is a semi-join (`exists`) on payment_receipts' unique index.
    index("receipt_uploads_validate_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.paymentId} is not null and ${table.screenedAt} is not null and ${table.validatedAt} is null`),
  ],
);

// A new level-1 reading of a receipt that already has one, asked for by a
// reviewer in Payments (ROADMAP Sessão 32). The first reading stays in
// payment_receipts, one per (upload, tier); every re-read is a row here, so
// the history of what the model said is never overwritten. The row is born
// with the request and filled once by the `receipt-reread` worker: the
// reading (or its failure) and the traffic light's verdict on it, stamped
// together. The verdict is guidance only — a re-read never moves the
// payment's status (owner, 22/10/2026).
export const receiptRereads = pgTable(
  "receipt_rereads",
  {
    id: uuidPk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    receiptUploadId: uuid("receipt_upload_id")
      .notNull()
      .references(() => receiptUploads.id, { onDelete: "restrict" }),
    // Better Auth's "user" is not modelled here; the FK is written by hand in
    // the migration, as for payments.decided_by.
    requestedBy: text("requested_by").notNull(),
    tier: integer("tier").notNull(),
    modelName: text("model_name"),
    modelVersion: text("model_version"),
    amountCents: integer("amount_cents"),
    operationNumber: text("operation_number"),
    extractedFields: jsonb("extracted_fields"),
    failureReason: text("failure_reason"),
    validationVerdict: text("validation_verdict"),
    validationDetail: jsonb("validation_detail"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    // One re-read in flight per receipt: a second click while the first is
    // still with the model is a 409, not a second model call.
    uniqueIndex("receipt_rereads_pending_uidx").on(table.receiptUploadId).where(sql`${table.readAt} is null`),
    index("receipt_rereads_receipt_upload_id_idx").on(table.receiptUploadId, table.readAt),
    // The relay's query: requests the worker has not answered yet.
    index("receipt_rereads_pending_created_at_idx").on(table.createdAt).where(sql`${table.readAt} is null`),
    check(
      "receipt_rereads_validation_verdict_check",
      sql`${table.validationVerdict} is null or ${table.validationVerdict} in ('approve', 'review', 'reject_suggested')`,
    ),
    // Read and judged in the same write: a finished row always has both.
    check("receipt_rereads_read_stamp_check", sql`(${table.readAt} is null) = (${table.validationVerdict} is null)`),
  ],
);

// One row per student waiting on a full class_group. Backoffice-only and
// manual since OOC-35; the public checkout offering it is still Sessão 22.
// FIFO by created_at; the partial unique pair stops the same student from
// queuing twice for the same class group while still in the queue.
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
    // Leaving the queue is marked, never deleted (CLAUDE.md §6). 'enrolled' is
    // written by the manual enrollment in the same transaction; the other two
    // by staff.
    leftAt: timestamp("left_at", { withTimezone: true }),
    leftReason: text("left_reason"),
    // The row changes once now (when it leaves the queue), so it carries
    // updated_at like every table that changes (packages/db CLAUDE.md).
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("waitlist_entries_active_uidx")
      .on(table.classGroupId, table.studentId)
      .where(sql`${table.leftAt} is null`),
    check(
      "waitlist_entries_left_reason_check",
      sql`${table.leftReason} is null or ${table.leftReason} in ('enrolled', 'withdrawn', 'removed_by_staff')`,
    ),
    check(
      "waitlist_entries_left_check",
      sql`(${table.leftAt} is null) = (${table.leftReason} is null)`,
    ),
    index("waitlist_entries_class_group_id_created_at_idx").on(table.classGroupId, table.createdAt),
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
    // The teacher file a `teacher` invite opens an account for (OOC-79) —
    // accepting it writes `teachers.user_id`. Only a `teacher` invite carries
    // one, and a pending one must (CHECK below; invites older than 0033 have
    // none, so it binds the pending ones only).
    teacherId: uuid("teacher_id").references(() => teachers.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("staff_invites_token_uidx").on(table.token),
    uniqueIndex("staff_invites_pending_email_uidx")
      .on(table.email)
      .where(sql`${table.status} = 'pending'`),
    // One open invite per teacher file: two would race for the same
    // `teachers.user_id` when accepted.
    uniqueIndex("staff_invites_pending_teacher_uidx")
      .on(table.teacherId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "staff_invites_teacher_check",
      sql`(${table.teacherId} is null or ${table.role} = 'teacher') and (${table.role} <> 'teacher' or ${table.status} <> 'pending' or ${table.teacherId} is not null)`,
    ),
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
  (table) => [
    index("audit_log_target_id_idx").on(table.targetId),
    // Reads by kind of event over a time window — the backoffice home counts
    // the day's approvals (OOC-67) on every visit, and would otherwise scan
    // the whole trail.
    index("audit_log_action_created_at_idx").on(table.action, table.createdAt),
    // The general log (OOC-122) pages the whole trail newest first by
    // `(created_at, id)` — without this every unfiltered page sorts every row
    // ever written — and filters by who did it.
    index("audit_log_created_at_id_idx").on(table.createdAt, table.id),
    index("audit_log_actor_id_created_at_idx").on(table.actorId, table.createdAt),
  ],
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

// One-time links that set a portal password: `activation` (the account was
// just created, no password yet) and `reset` ("forgot my password"). One
// table, because both land on the same screen and do the same thing.
//
// Unlike `staffInvites`, the token is stored as a SHA-256 hash: these are
// thousands of student accounts, the link is e-mailed rather than handed over
// by someone who checked who was asking, and the token alone hands over the
// account. A new token marks the pending ones of the same user and purpose as
// used — only the latest link works.
export const portalAccessTokens = pgTable(
  "portal_access_tokens",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("portal_access_tokens_token_hash_uidx").on(table.tokenHash),
    index("portal_access_tokens_user_id_created_at_idx").on(table.userId, table.createdAt),
    check("portal_access_tokens_purpose_check", sql`${table.purpose} in ('activation', 'reset')`),
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

// Transactional outbox (apps/api/CLAUDE.md, "Notificações"): the use case that
// decides a message must go out writes the row in the SAME transaction as the
// business change that caused it — an enrollment committed without its e-mail,
// or an e-mail about an enrollment that rolled back, are both impossible. The
// relay worker picks up `pending` rows and the send-email worker delivers them
// through NotificationProvider; the provider (Brevo today) is never named here.
//
// One row is one message to one recipient, not one domain event: a minor's
// enrollment produces two rows (student + guardian, CLAUDE.md §1), and each
// is delivered, retried and audited on its own.
//
// `dedupe_key` is what makes emitting idempotent — `<template>:<subject id>:
// <recipient kind>`, inserted with ON CONFLICT DO NOTHING, so a retried
// transaction can never queue the same message twice.
//
// `recipient` and `vars` carry PII (e-mail, names) — never logged
// (CLAUDE.md §6); `last_error` only ever holds a provider status code, never
// the provider's free-text message, which can echo the address back.
//
// No `deleted_at`: a row is a record that a message was (or was not) sent,
// and its life is told by `status`.
export const outbox = pgTable(
  "outbox",
  {
    id: uuidPk(),
    channel: text("channel").notNull().default("email"),
    templateKey: text("template_key").notNull(),
    recipient: text("recipient").notNull(),
    locale: text("locale").notNull(),
    vars: jsonb("vars").notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("outbox_dedupe_key_uidx").on(table.dedupeKey),
    check("outbox_channel_check", sql`${table.channel} in ('email')`),
    check("outbox_locale_check", sql`${table.locale} in ('es-PE', 'pt-BR', 'en')`),
    // pending → sent | blocked | failed. `blocked` is the allowlist guard
    // refusing a recipient outside production (CLAUDE.md §6) — a decision,
    // not an error, so it is never retried.
    check("outbox_status_check", sql`${table.status} in ('pending', 'sent', 'blocked', 'failed')`),
    check("outbox_attempts_check", sql`${table.attempts} >= 0`),
    // The relay's only query: the oldest pending rows first.
    index("outbox_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

// The numbers the platform runs on that the backoffice may change without a
// deploy (apps/api/CLAUDE.md: "configuráveis no backoffice, nunca constante no
// código"). One row, enforced by the primary key itself: `id` is a boolean
// that can only be `true`. Typed columns rather than a key/value bag, so each
// setting carries its own CHECK — a setting the database cannot bound is one
// a bad request can set to zero.
//
// The checkout hold and the receipt traffic light's two numbers (OOC-21) live
// here. The review window and the OCR confidence floor are still screen-only
// in the backoffice; each lands as its own column when something server-side
// reads it.
//
// `updated_by` is Better Auth's "user".id (text), no FK — same situation as
// `feature_flag_overrides.updated_by`. Who changed what is answered by
// `audit_log`, which every write here also appends to.
export const platformSettings = pgTable(
  "platform_settings",
  {
    id: boolean("id").primaryKey().default(true),
    checkoutHoldMinutes: integer("checkout_hold_minutes").notNull().default(15),
    // OOC-21: how far ABOVE the expected amount is still green (it only
    // validates — a person approves).
    // Never below — "Sem descontos. Nunca." (CLAUDE.md §1).
    receiptAmountToleranceCents: integer("receipt_amount_tolerance_cents").notNull().default(0),
    // OOC-21: below this percentage of the expected amount, rejection is
    // suggested to the reviewer. 50 is provisional (owner, 03/10/2026).
    receiptRejectBelowPercent: integer("receipt_reject_below_percent").notNull().default(50),
    // OOC-41: the long clock — receipt sent → decision. One number for both
    // what the checkout promises the student and the deadline Payments works
    // to (owner, 22/10/2026).
    reviewWindowDays: integer("review_window_days").notNull().default(5),
    // OOC-41: below this confidence (whole percent) a field read by the OCR
    // is flagged to the reviewer; level 2 escalates on it once it exists
    // (Sessão 29). Whole percent, never a float.
    ocrLowConfidencePercent: integer("ocr_low_confidence_percent").notNull().default(75),
    // OOC-41: academic rules, on the 0–20 scale and in business days.
    passingGrade: integer("passing_grade").notNull().default(14),
    certificateDeadlineBusinessDays: integer("certificate_deadline_business_days").notNull().default(25),
    // OOC-41: today's price of the constancia. A request will freeze the
    // value it was asked at — changing this never reprices one already made.
    constanciaFeeCents: integer("constancia_fee_cents").notNull().default(2500),
    // OOC-41: how early a teacher's contract starts warning. 45 is
    // provisional (CLAUDE.md §1).
    contractAlertDays: integer("contract_alert_days").notNull().default(45),
    updatedBy: text("updated_by"),
    ...timestamps(),
  },
  (table) => [
    check("platform_settings_singleton_check", sql`${table.id}`),
    check(
      "platform_settings_checkout_hold_minutes_check",
      sql`${table.checkoutHoldMinutes} between 5 and 60`,
    ),
    check(
      "platform_settings_receipt_amount_tolerance_cents_check",
      sql`${table.receiptAmountToleranceCents} between 0 and 5000`,
    ),
    check(
      "platform_settings_receipt_reject_below_percent_check",
      sql`${table.receiptRejectBelowPercent} between 1 and 99`,
    ),
    check("platform_settings_review_window_days_check", sql`${table.reviewWindowDays} between 1 and 30`),
    check(
      "platform_settings_ocr_low_confidence_percent_check",
      sql`${table.ocrLowConfidencePercent} between 50 and 95`,
    ),
    check("platform_settings_passing_grade_check", sql`${table.passingGrade} between 0 and 20`),
    check(
      "platform_settings_certificate_deadline_business_days_check",
      sql`${table.certificateDeadlineBusinessDays} between 1 and 90`,
    ),
    check(
      "platform_settings_constancia_fee_cents_check",
      sql`${table.constanciaFeeCents} between 100 and 100000`,
    ),
    check("platform_settings_contract_alert_days_check", sql`${table.contractAlertDays} between 1 and 180`),
  ],
);

// ---------------------------------------------------------------------------
// Editable document templates (OOC-123)
// ---------------------------------------------------------------------------

// The workbench: one draft per document kind, rewritten on every save and
// allowed to be wrong. A draft issues nothing, so it is an ordinary mutable
// row. `updated_by` is Better Auth's "user".id — FK written by hand in 0034.
export const documentTemplateDrafts = pgTable(
  "document_template_drafts",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    updatedBy: text("updated_by").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("document_template_drafts_kind_uidx").on(table.kind)],
);

// What documents are issued from: append-only (0034 lock), numbered per kind.
// The one in force is the highest `version`; a document generated from it
// points here and keeps pointing after a newer one is published.
// `published_by` is Better Auth's "user".id — FK written by hand in 0034.
export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    publishedBy: text("published_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("document_template_versions_kind_version_uidx").on(table.kind, table.version),
    check("document_template_versions_version_check", sql`${table.version} > 0`),
  ],
);
