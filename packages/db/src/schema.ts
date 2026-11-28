import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  pgView,
  primaryKey,
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

// The languages the catalog is organized by (OOC-128). Before it, a course's
// language was free text and the catalog grouped by the spelling, so "INGLES"
// next to "Inglés" opened a second English. `key` is the name compared without
// case, accents or stray spaces (languageKey in @ooc/domain) — one live
// language per key. Retired, never deleted: a course that ran under a language
// keeps pointing at it.
export const languages = pgTable(
  "languages",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    ...softDeletable(),
  },
  (table) => [uniqueIndex("languages_key_live_uidx").on(table.key).where(sql`${table.deletedAt} is null`)],
);

// Each language track (Kids, Básico, Intermediário/Avançado...) is its own
// course, not a variant of plan within a single "Inglês" course — min_age
// is validated per course (docs/ROADMAP.md Sessão 21) and tracks have
// different minimum ages (docs/REGRAS-NEGOCIO.md §2).
export const courses = pgTable(
  "courses",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    // The language's name, kept equal to languages.name by the API while the
    // screens and queries that read the text move to language_id (OOC-128,
    // expand/contract §7). Write both or neither.
    language: text("language").notNull(),
    languageId: uuid("language_id").references(() => languages.id, { onDelete: "restrict" }),
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
    // "Cambio de aula" (another schedule) — the name predates the screen's label.
    allowsTransfer: boolean("allows_transfer").notNull().default(false),
    // "Traspaso de matrícula" (OOC-105): handing the enrollment to another
    // person. Free and offered by default (docs/REGRAS-NEGOCIO.md §5).
    allowsEnrollmentTransfer: boolean("allows_enrollment_transfer").notNull().default(true),
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
    // How the plan is paid (OOC-86, CLAUDE.md §1): 'package' is one payment
    // for the whole plan; 'monthly' is a prepaid purchase of one module at a
    // time, and the plan's price is the price of one module. A property of the
    // plan, never of the language: no code asks "is this English".
    billing: text("billing").notNull().default("package"),
    ...softDeletable(),
  },
  (table) => [
    index("plans_course_id_idx").on(table.courseId),
    check("plans_billing_check", sql`${table.billing} in ('package', 'monthly')`),
  ],
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
// The number behind every generated class group code (`classGroupCodeOf` in
// the domain, `A-00042`). A sequence, not max(code)+1: two panels saving at
// once never draw the same number, and a number burned by a failed save is
// skipped rather than reused.
export const classGroupCodeSeq = pgSequence("class_group_code_seq", { startWith: 1 });

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
    // side. Default '' only so the column can land aditively. Since 0039 the
    // panel draws it from class_group_code_seq and nobody edits it; legacy
    // rows keep the code they came with. No unique index: the legacy import
    // may have written the same course+date fallback twice.
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
    // One Classroom per module the class group teaches (OOC-144): module
    // number (as text, JSON keys are text) → link. Replaces `classroom_url`,
    // which stays read only for class groups with no module set until the
    // contract step (CLAUDE.md §7). Keys and the host rule are the domain's.
    // A module the group no longer teaches keeps its link: progression
    // (OOC-85) moves the group on, the old Classroom is still that module's.
    classroomLinks: jsonb("classroom_links").$type<Record<string, string>>().notNull().default({}),
    // Which of the course's modules the class group teaches, 1-based
    // (OOC-100) — what picks the module material its teacher opens. Null on
    // every row written before the column. The upper bound (the course's
    // module count) is the domain's: a course cut to fewer modules must not
    // turn its class groups into rows the database refuses.
    module: integer("module"),
    // Runs every module of the course instead of one (OOC-130). Separate from
    // `module` because null there means "nobody set it yet", and a class group
    // that teaches the whole course has been set.
    fullCourse: boolean("full_course").notNull().default(false),
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
    // Erased from the catalog for good (23/11/2026): a class group with
    // history that someone deleted. It cannot be deleted for real — its
    // enrollments and payments point at it — so it leaves every catalog
    // screen instead, and nothing brings it back. Always retired too.
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    // A demo class group (28/11/2026): opened by the owners' demo-access tool
    // so a client can see the portals from the inside. It never sells, and
    // every list the team works from leaves it out (apps/api, "Contas demo").
    isDemo: boolean("is_demo").notNull().default(false),
    // The class group this one was copied from when a period was duplicated —
    // the trail, and what stops the same copy from running twice.
    sourceClassGroupId: uuid("source_class_group_id").references(
      (): AnyPgColumn => classGroups.id,
      { onDelete: "restrict" },
    ),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").notNull().default(0),
    // Seats held above capacity (OOC-155): an expired checkout hold that came
    // back paid to a full schedule, or the staff enrolling or moving past the
    // limit on purpose. Kept apart from `seats_taken` so the capacity check
    // above stays a real net; "room left" is `seats_taken + seats_over <
    // capacity` (apps/api, classGroupHasRoom).
    seatsOver: integer("seats_over").notNull().default(0),
    status: text("status").notNull().default("enrolling"),
    ...softDeletable(),
  },
  (table) => [
    check("class_groups_capacity_check", sql`${table.capacity} > 0`),
    check("class_groups_seats_over_check", sql`${table.seatsOver} >= 0`),
    check("class_groups_module_check", sql`${table.module} is null or ${table.module} > 0`),
    check("class_groups_full_course_check", sql`not ${table.fullCourse} or ${table.module} is null`),
    check("class_groups_classroom_links_check", sql`jsonb_typeof(${table.classroomLinks}) = 'object'`),
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
    // An erased class group is a retired one that can no longer come back.
    check("class_groups_erased_check", sql`${table.erasedAt} is null or ${table.deletedAt} is not null`),
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
    // Set by the Brevo webhook on a hard bounce to the address above (OOC-91):
    // the address is dead, not the student. Cleared when the address changes —
    // the flag is about THIS e-mail, never about the person.
    emailInvalidAt: timestamp("email_invalid_at", { withTimezone: true }),
    // A demo student (28/11/2026): written by the owners' demo-access tool,
    // left out of every list the team works from.
    isDemo: boolean("is_demo").notNull().default(false),
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
// A shared Google Classroom login (OOC-196). The institution does not open one
// Google account per teacher: one account is lent to several teachers at a
// time (3–7 in high season), and coordination hands out its e-mail and
// password. The password is kept encrypted (AES-256-GCM, key in the API's
// CLASSROOM_CREDENTIALS_KEY, never in the database), because the teacher
// portal has to show it back. `password_changed_at` and `released_at` (the
// last time a teacher stopped using it) are what flags "change the password":
// a teacher who left still knows the old one.
export const classroomAccounts = pgTable(
  "classroom_accounts",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    // `v1:` + base64(iv ‖ tag ‖ ciphertext). The prefix names the key version.
    passwordCiphertext: text("password_ciphertext").notNull(),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...softDeletable(),
  },
  (table) => [
    uniqueIndex("classroom_accounts_email_live_uidx")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const teachers = pgTable(
  "teachers",
  {
    id: uuidPk(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // The profile — document, phone, origin, address — is all-or-nothing
    // (teachers_profile_check): null while the teacher has not completed the
    // onboarding of a file coordination left pending (OOC-103).
    nationalIdType: text("national_id_type"),
    nationalId: text("national_id"),
    email: text("email").notNull(),
    // Optional, any provider (OOC-161): the teacher's own mail — where the
    // monthly feedback report goes, at the administration's request. `email`
    // above stays what the panel invite goes to and the contract prints.
    // Not part of the onboarding profile (OOC-103): coordination's, as before.
    personalEmail: text("personal_email"),
    phone: text("phone"),
    // ISO 3166-1 alpha-2 — where they are from; a selling point in the catalog.
    nationality: text("nationality"),
    // ISO 3166-1 alpha-2 — where they live; the contract needs an address.
    country: text("country"),
    // First-level division ("departamento" in Peru). Null outside it.
    region: text("region"),
    city: text("city"),
    addressLine: text("address_line"),
    status: text("status").notNull().default("active"),
    userId: text("user_id"),
    // The shared Classroom login the teacher uses (OOC-196) — one at a time.
    // Cleared when the teacher leaves the roster.
    // A demo teacher (28/11/2026): written by the owners' demo-access tool,
    // left out of every list the team works from.
    isDemo: boolean("is_demo").notNull().default(false),
    classroomAccountId: uuid("classroom_account_id").references(() => classroomAccounts.id, {
      onDelete: "restrict",
    }),
    ...softDeletable(),
  },
  (table) => [
    index("teachers_classroom_account_id_idx").on(table.classroomAccountId),
    check("teachers_national_id_type_check", nationalIdTypeCheck('"national_id_type"')),
    check("teachers_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "teachers_profile_check",
      sql`num_nulls(${table.nationalIdType}, ${table.nationalId}, ${table.phone}, ${table.nationality}, ${table.country}, ${table.city}, ${table.addressLine}) = 0 or (num_nulls(${table.nationalIdType}, ${table.nationalId}, ${table.phone}, ${table.nationality}, ${table.country}, ${table.city}, ${table.addressLine}) = 7 and ${table.region} is null)`,
    ),
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
    // Same pairing as courses.language/language_id (OOC-128).
    language: text("language").notNull(),
    languageId: uuid("language_id").references(() => languages.id, { onDelete: "restrict" }),
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

// A module run of a class group — the "sub-turma" (OOC-156, decisions of
// 14/11/2026). The class group keeps what is sold: course, period, code,
// dates, capacity and the seats, counted across all of its modules. The
// teaching happens here: each module run has its own schedule, teacher and
// Classroom, and the runs of one class group go on at the same time.
//
// The columns are the teaching columns `class_groups` carried until now, with
// the same meaning, so every domain rule over them (`classroomLinksOf`,
// `taughtModules`, the module material) reads a module run unchanged:
// `module` (null = nobody set it), `full_course` (the run teaches every module
// of the course, `module` null), `teacher_id`, `slots`, `classroom_links`
// (module → link) and the legacy `classroom_url`/`teacher_name`.
//
// 0058 gave each existing class group one module run holding its own values,
// **under the class group's own id**: a teacher's bookmark
// (/docente/class-groups/<id>), a grade still waiting in a teacher's device
// outbox and every enrollment keep pointing at the right run without being
// rewritten. A run created later gets an id of its own. The same columns on
// `class_groups` are frozen from 0058 on — nothing writes or reads them — and
// leave in the contract step (CLAUDE.md §7).
//
// One live run per module of a class group (partial unique index), and at most
// one live run with no module number — the full-course one or the unset one,
// each of which is alone in its class group (the domain's rule:
// `ClassGroup.assertModulesConsistent`).
export const classGroupModules = pgTable(
  "class_group_modules",
  {
    id: uuidPk(),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    module: integer("module"),
    fullCourse: boolean("full_course").notNull().default(false),
    teacherId: uuid("teacher_id").references(() => teachers.id, { onDelete: "restrict" }),
    // The free-text teacher name of a class group made before teachers had a
    // file, copied by 0058 as the hint the pending queue shows. Nothing new
    // writes one; allocating a teacher clears it.
    teacherName: text("teacher_name").notNull().default(""),
    slots: jsonb("slots").notNull().default([]),
    classroomLinks: jsonb("classroom_links").$type<Record<string, string>>().notNull().default({}),
    // OOC-98's single link, read only for a run with no module set.
    classroomUrl: text("classroom_url"),
    // Its Google Meet (OOC-159), pasted by coordination. Null = nobody pasted
    // one yet. The host rule (https on meet.google.com) is the domain's
    // (normalizeMeetUrl), as the Classroom's.
    meetUrl: text("meet_url"),
    // The day the module ends in this run (OOC-180): a calendar day in Lima,
    // set by the staff in the run's form. The grade register's deadline runs
    // from it. Null = nobody set it yet, and the register has no deadline.
    moduleEndsOn: date("module_ends_on", { mode: "string" }),
    ...softDeletable(),
  },
  (table) => [
    check("class_group_modules_module_check", sql`${table.module} is null or ${table.module} > 0`),
    check("class_group_modules_full_course_check", sql`not ${table.fullCourse} or ${table.module} is null`),
    check("class_group_modules_classroom_links_check", sql`jsonb_typeof(${table.classroomLinks}) = 'object'`),
    uniqueIndex("class_group_modules_module_live_uidx")
      .on(table.classGroupId, table.module)
      .where(sql`${table.deletedAt} is null and ${table.module} is not null`),
    uniqueIndex("class_group_modules_unnumbered_live_uidx")
      .on(table.classGroupId)
      .where(sql`${table.deletedAt} is null and ${table.module} is null`),
    // The target of enrollments' composite FK: a module run of the
    // enrollment's own class group, never of another.
    uniqueIndex("class_group_modules_id_class_group_uidx").on(table.id, table.classGroupId),
    index("class_group_modules_class_group_id_idx").on(table.classGroupId),
    index("class_group_modules_teacher_id_idx").on(table.teacherId),
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
    // platform. 'whatsapp_ai' is the WhatsApp AI assistant's link (OOC-139).
    // Default 'web' only so the column lands additively on existing rows
    // written before this column existed.
    origin: text("origin").notNull().default("web"),
    // The seat this enrollment holds is counted in `class_groups.seats_over`,
    // not `seats_taken` (OOC-155). Giving the seat back decrements whichever
    // counter this says.
    overCapacity: boolean("over_capacity").notNull().default(false),
    // The module run the student is in now (OOC-156) — always one of the
    // enrollment's own class group (composite FK below). Null only on a row
    // written by the code that ran before 0058, which every reader resolves
    // as the run sharing the class group's id (0058's backfill rule). Moves
    // with the staff moving the seat, and with progression.
    classGroupModuleId: uuid("class_group_module_id"),
    // Which time through its current run this is (OOC-156): 1 on entering a
    // run, one more each time the student repeats it after a failed module or
    // a DA. A grade belongs to one attempt, so repeating never collides with
    // the grade of the time before.
    moduleAttempt: integer("module_attempt").notNull().default(1),
    // When the student entered the run and attempt they are on (OOC-86): set
    // on insert, by progression (advance or repeat) and by moving the seat to
    // another run. It is what "owes module N since" reads for a monthly seat.
    moduleEnteredAt: timestamp("module_entered_at", { withTimezone: true }).notNull().defaultNow(),
    ...softDeletable(),
  },
  (table) => [
    check("enrollments_module_attempt_check", sql`${table.moduleAttempt} > 0`),
    foreignKey({
      name: "enrollments_class_group_module_fk",
      columns: [table.classGroupModuleId, table.classGroupId],
      foreignColumns: [classGroupModules.id, classGroupModules.classGroupId],
    }).onDelete("restrict"),
    index("enrollments_class_group_module_id_idx").on(table.classGroupModuleId),
    check(
      "enrollments_seat_status_check",
      sql`"seat_status" in ('reserved', 'confirmed', 'released', 'frozen')`,
    ),
    check("enrollments_origin_check", sql`"origin" in ('whatsapp', 'whatsapp_ai', 'web')`),
    index("enrollments_student_id_idx").on(table.studentId),
    index("enrollments_class_group_id_idx").on(table.classGroupId),
    // A confirmed, live seat per class group — Enrollments' default list and
    // the "active student" count (OOC-112).
    index("enrollments_confirmed_class_group_id_idx")
      .on(table.classGroupId)
      .where(sql`${table.seatStatus} = 'confirmed' and ${table.deletedAt} is null`),
  ],
);

// A frozen enrollment (OOC-84, CLAUDE.md §1): the seat went back to its class
// group, and the student comes back later to the module they stopped in. One
// row per freeze, with where it stopped — class group, module run, module and
// attempt — so the return knows which module to land on. Append-only: a
// freeze is history; coming back is a row of its own, below. Both layers
// (0066), never one.
export const enrollmentFreezes = pgTable(
  "enrollment_freezes",
  {
    id: uuidPk(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    classGroupModuleId: uuid("class_group_module_id").notNull(),
    // Null when the run had no module number: the return then takes any run
    // of the same course with none.
    module: integer("module"),
    attempt: integer("attempt").notNull(),
    // FK to "user" written by hand in the migration, as for decided_by (0027).
    // The staff account, or the student's account when a paid request from
    // the portal froze it.
    frozenBy: text("frozen_by").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    check("enrollment_freezes_attempt_check", sql`${table.attempt} > 0`),
    // Named by hand: the generated name passes Postgres' 63 characters.
    foreignKey({
      name: "enrollment_freezes_module_fk",
      columns: [table.classGroupModuleId],
      foreignColumns: [classGroupModules.id],
    }).onDelete("restrict"),
    index("enrollment_freezes_enrollment_id_idx").on(table.enrollmentId, table.createdAt),
  ],
);

// Coming back from a freeze (OOC-84): staff picks a run of the module the
// student stopped in, and the seat is taken there. One per freeze.
export const enrollmentFreezeReturns = pgTable(
  "enrollment_freeze_returns",
  {
    id: uuidPk(),
    freezeId: uuid("freeze_id")
      .notNull()
      .references(() => enrollmentFreezes.id, { onDelete: "restrict" }),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    classGroupModuleId: uuid("class_group_module_id").notNull(),
    returnedBy: text("returned_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("enrollment_freeze_returns_freeze_id_uidx").on(table.freezeId),
    foreignKey({
      name: "enrollment_freeze_returns_module_fk",
      columns: [table.classGroupModuleId],
      foreignColumns: [classGroupModules.id],
    }).onDelete("restrict"),
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
    check("seat_holds_origin_check", sql`${table.origin} in ('whatsapp', 'whatsapp_ai', 'web')`),
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

// What a paid procedure costs (docs/REGRAS-NEGOCIO.md §5), versioned exactly
// like plan_prices: append-only, and the price in force is the row with the
// greatest valid_from <= now(). Replaces platform_settings.constancia_fee_cents
// (OOC-83), which stays until the contract step and nothing reads any more.
export const procedurePrices = pgTable(
  "procedure_prices",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    // Better Auth's "user" is not modelled here; FK written by hand in 0046.
    // Null only for the row the migration carried over from the settings.
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (table) => [
    check("procedure_prices_kind_check", sql`${table.kind} in ('enrollment_certificate')`),
    check("procedure_prices_amount_cents_check", sql`${table.amountCents} > 0`),
    index("procedure_prices_kind_valid_from_idx").on(table.kind, table.validFrom),
  ],
);

// A student asking for a paid procedure (OOC-83, CLAUDE.md §1: "solicitação
// com pagamento associado"). Born before its payment, because the receipt
// upload needs a server-minted id to hang off, the way the checkout's hangs off
// the seat hold. `amount_cents` freezes the price at the moment of asking, as
// an enrollment freezes its plan_price_id; `procedure_price_id` says which
// version it came from.
//
// requested → paid (payment approved) → fulfilled (the procedure's own flow,
// OOC-33 for the constancia); requested → rejected (payment rejected). A
// rejected request is final: trying again is a new request.
export const procedureRequests = pgTable(
  "procedure_requests",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    // The enrollment the procedure is about. Required while the only kind is
    // the constancia; a procedure with no enrollment behind it (the placement
    // exam) would loosen it with its own migration.
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    procedurePriceId: uuid("procedure_price_id")
      .notNull()
      .references(() => procedurePrices.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("requested"),
    ...timestamps(),
  },
  (table) => [
    check("procedure_requests_kind_check", sql`${table.kind} in ('enrollment_certificate')`),
    check("procedure_requests_amount_cents_check", sql`${table.amountCents} > 0`),
    check(
      "procedure_requests_status_check",
      sql`${table.status} in ('requested', 'paid', 'fulfilled', 'rejected')`,
    ),
    // One live request per procedure and enrollment: a second tap reuses the
    // first, and a constancia already paid for is not bought twice.
    uniqueIndex("procedure_requests_live_uidx")
      .on(table.enrollmentId, table.kind)
      .where(sql`${table.status} in ('requested', 'paid')`),
    index("procedure_requests_student_id_idx").on(table.studentId),
  ],
);

// payments is agnostic of origin (apps/api/CLAUDE.md, Pagamento): it pays for
// exactly one enrollment or one procedure request (OOC-83,
// payments_origin_check). Every read that follows `enrollment_id` with an inner
// join leaves procedure payments out, which is right for whatever is about the
// seat (the enrollment ledger, the roster) and wrong for whatever is about the
// money (Payments, the receipt pipeline): those go through the request.
//
// idempotency_key is unique and required on every row (CLAUDE.md §5, "duplo
// POST de celular ruim é certeza") — this is the Sessão 6 "pronto quando"
// check: a duplicate payment insert must fail in the database, not just in
// application code.
export const payments = pgTable(
  "payments",
  {
    id: uuidPk(),
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id, { onDelete: "restrict" }),
    procedureRequestId: uuid("procedure_request_id").references(() => procedureRequests.id, { onDelete: "restrict" }),
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
    check("payments_origin_check", sql`num_nonnulls("enrollment_id", "procedure_request_id") = 1`),
    // One payment per request: a rejected payment ends its request, so paying
    // again is a new request and never a second payment on this one.
    uniqueIndex("payments_procedure_request_id_uidx")
      .on(table.procedureRequestId)
      .where(sql`${table.procedureRequestId} is not null`),
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

// A lot (OOC-158): one receipt paying for several enrollments of the public
// checkout — the same student in more than one course, several children, or
// both. The payment keeps its own `enrollment_id` (the lot's first item, so
// payments_origin_check and every read about the money stay as they are);
// this table lists the OTHER enrollments the same payment pays for, and only
// for a lot — a payment with no rows here pays for its `enrollment_id` alone.
// An enrollment belongs to at most one lot (unique `enrollment_id`). Reads
// about the seat go through `payment_coverage`, never through either one.
// Append-only: what a payment paid for is history (REVOKE + trigger, 0060).
export const paymentLotEnrollments = pgTable(
  "payment_lot_enrollments",
  {
    id: uuidPk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("payment_lot_enrollments_enrollment_id_uidx").on(table.enrollmentId),
    index("payment_lot_enrollments_payment_id_idx").on(table.paymentId),
  ],
);

// The modules a payment of a monthly enrollment buys (OOC-86), one row per
// module and attempt. A student who repeats a module buys it again (decision
// of 20/11/2026), so the attempt is part of what was bought: paying module 3
// covers the attempt it was bought for, never the next time through. Paying
// ahead buys the first attempt of the modules after the current one.
//
// Append-only: what a payment bought is history. A rejected payment keeps its
// rows — coverage reads only rows whose payment is still alive, so the module
// is open to buy again. Both layers (0064), never one.
export const paymentModules = pgTable(
  "payment_modules",
  {
    id: uuidPk(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    module: integer("module").notNull(),
    attempt: integer("attempt").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("payment_modules_module_check", sql`${table.module} > 0`),
    check("payment_modules_attempt_check", sql`${table.attempt} > 0`),
    uniqueIndex("payment_modules_payment_module_uidx").on(table.paymentId, table.enrollmentId, table.module, table.attempt),
    index("payment_modules_enrollment_id_idx").on(table.enrollmentId, table.module, table.attempt),
  ],
);

// Every enrollment a payment pays for (OOC-158), one row each: the payment's
// own `enrollment_id`, plus the other items of its lot. A view written by hand
// in 0060. Every read about the seat that asks "which payment speaks for this
// enrollment" — the enrollment ledger, the roster, the student's history, the
// portal — joins this instead of `payments.enrollment_id`, so the second
// child of a lot is not an enrollment without a payment.
export const paymentCoverage = pgView("payment_coverage", {
  paymentId: uuid("payment_id").notNull(),
  enrollmentId: uuid("enrollment_id").notNull(),
}).existing();

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
    // Whose receipt this is before there is a payment: the checkout's hold,
    // the procedure request of a signed-in student (OOC-83), or the staff
    // account opening a manual enrollment (OOC-146) — exactly one,
    // receipt_uploads_owner_check.
    seatHoldId: uuid("seat_hold_id").references(() => seatHolds.id, { onDelete: "restrict" }),
    procedureRequestId: uuid("procedure_request_id").references(() => procedureRequests.id, { onDelete: "restrict" }),
    // FK to "user" written by hand in the migration, as for decided_by (0027).
    uploadedBy: text("uploaded_by"),
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
      "receipt_uploads_owner_check",
      sql`num_nonnulls("seat_hold_id", "procedure_request_id", "uploaded_by") = 1`,
    ),
    index("receipt_uploads_procedure_request_id_idx")
      .on(table.procedureRequestId)
      .where(sql`${table.procedureRequestId} is not null`),
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
    // The cargo created in Equipo an invite opens the account on (OOC-183) —
    // set exactly when `role` is `custom` (CHECK below).
    profileId: uuid("profile_id").references(() => staffProfiles.id, { onDelete: "restrict" }),
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
      sql`${table.role} in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing', 'custom')`,
    ),
    check("staff_invites_profile_check", sql`(${table.role} = 'custom') = (${table.profileId} is not null)`),
    check("staff_invites_status_check", sql`${table.status} in ('pending', 'completed', 'cancelled')`),
  ],
);

// The cargos, as data (OOC-57, OOC-183). One row per cargo of the board —
// `role_key`, the `"user".role` its accounts carry, named by the locale — and
// one per cargo administration creates in Equipo — `name`, as typed; its
// accounts carry the `custom` role and point here by `"user".profile_id`. What
// each holds is `staff_profile_permissions`. A created cargo retires
// (`deleted_at`) once no account or open invite uses it, and so does a board
// cargo but master and teacher (0080) — its row stays retired, so the boot
// never writes it again. The board rows are written by the API on boot, not by a migration:
// the permission catalog is code (`packages/domain`, permissionCatalog.ts).
export const staffProfiles = pgTable(
  "staff_profiles",
  {
    id: uuidPk(),
    roleKey: text("role_key"),
    name: text("name"),
    createdBy: text("created_by"),
    ...softDeletable(),
  },
  (table) => [
    uniqueIndex("staff_profiles_role_key_uidx").on(table.roleKey),
    // Two live cargos never share a name, compared without case.
    uniqueIndex("staff_profiles_name_live_uidx")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null and ${table.name} is not null`),
    check("staff_profiles_kind_check", sql`num_nonnulls(${table.roleKey}, ${table.name}) = 1`),
    check(
      "staff_profiles_role_key_check",
      sql`${table.roleKey} is null or ${table.roleKey} in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing')`,
    ),
  ],
);

// What a cargo can do: one row per permission it holds (keys from the domain's
// permission catalog — no CHECK, a new permission must not cost a migration,
// like `courses.landing_key`). Editing a cargo replaces its rows; who changed
// what lands in `audit_log`.
export const staffProfilePermissions = pgTable(
  "staff_profile_permissions",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => staffProfiles.id, { onDelete: "restrict" }),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.permission] })],
);

// Every permission key the API has already handed to the board's cargos by
// default. A key not here yet is new: on boot the API grants it to the cargos
// its catalog entry names, and records it — so what administration takes away
// afterwards is never granted back.
export const staffPermissionSeeds = pgTable("staff_permission_seeds", {
  permission: text("permission").primaryKey(),
  seededAt: timestamp("seeded_at", { withTimezone: true }).notNull().defaultNow(),
});

// One grade per seat in a class group (OOC-38, CLAUDE.md §1, decision
// 08/10/2026): the final exam's, which is the module's grade, on the 0–20
// scale with decimals — or DA, the final exam not sat, in its place. Posted
// once and locked: append-only, no UPDATE nor DELETE, on both layers (0051).
// Whether it passes is read against `platform_settings.passing_grade` at the
// time it is read, never stored here.
export const grades = pgTable(
  "grades",
  {
    id: uuidPk(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    // The module run and the attempt the grade was posted in (OOC-156, 0059).
    // Null run only on a grade posted before 0059: its run is the one 0058
    // made under the class group's id, which is what every reader resolves
    // with `coalesce(class_group_module_id, class_group_id)`.
    classGroupModuleId: uuid("class_group_module_id"),
    attempt: integer("attempt").notNull().default(1),
    // Exact decimal, two places (`13.50`): a grade is compared as typed.
    score: numeric("score", { precision: 4, scale: 2, mode: "number" }),
    didNotSit: boolean("did_not_sit").notNull().default(false),
    // The grade register the grade was posted into (OOC-180). Null only on a
    // grade posted before registers existed — read as official, which is what
    // it was under the rule of the day ("final as posted").
    registerId: uuid("register_id").references((): AnyPgColumn => gradeRegisters.id, { onDelete: "restrict" }),
    // Better Auth's "user" is not modelled here; FK written by hand in 0051.
    recordedBy: text("recorded_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One grade per seat, run and attempt (OOC-156): written by hand in 0059
    // as an expression index over coalesce(class_group_module_id,
    // class_group_id), which replaced grades_class_group_enrollment_uidx.
    foreignKey({
      name: "grades_class_group_module_fk",
      columns: [table.classGroupModuleId, table.classGroupId],
      foreignColumns: [classGroupModules.id, classGroupModules.classGroupId],
    }).onDelete("restrict"),
    check("grades_attempt_check", sql`${table.attempt} > 0`),
    check(
      "grades_value_check",
      sql`(${table.didNotSit} and ${table.score} is null) or (not ${table.didNotSit} and ${table.score} between 0 and 20)`,
    ),
  ],
);

// A correction of a posted grade (OOC-102, decision of 10/11/2026): the
// academic supervision fixes a grade with a reason, and the grade row itself
// never changes — `grades` stays append-only. Each correction names the one it
// replaces, so the history of a grade is a straight line: one first
// correction per grade, one successor per correction (partial unique indexes,
// 0052). The grade that counts is the line's last link — `current_grades`.
// Append-only, both layers (REVOKE + trigger, 0052).
export const gradeCorrections = pgTable(
  "grade_corrections",
  {
    id: uuidPk(),
    gradeId: uuid("grade_id")
      .notNull()
      .references(() => grades.id, { onDelete: "restrict" }),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => gradeCorrections.id, { onDelete: "restrict" }),
    score: numeric("score", { precision: 4, scale: 2, mode: "number" }),
    didNotSit: boolean("did_not_sit").notNull().default(false),
    // Who changed it (OOC-180): the supervision's correction, with a reason,
    // or the teacher's own edit while the register was still theirs — no
    // reason asked. Same line of history either way.
    kind: text("kind").notNull().default("correction"),
    reason: text("reason"),
    // Better Auth's "user" is not modelled here; FK written by hand in 0052.
    correctedBy: text("corrected_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("grade_corrections_first_uidx").on(table.gradeId).where(sql`${table.replacesId} is null`),
    uniqueIndex("grade_corrections_replaces_uidx").on(table.replacesId).where(sql`${table.replacesId} is not null`),
    check(
      "grade_corrections_value_check",
      sql`(${table.didNotSit} and ${table.score} is null) or (not ${table.didNotSit} and ${table.score} between 0 and 20)`,
    ),
    check("grade_corrections_kind_check", sql`${table.kind} in ('correction', 'teacher_edit')`),
    check(
      "grade_corrections_reason_check",
      sql`(${table.kind} = 'teacher_edit' and ${table.reason} is null) or (${table.kind} = 'correction' and length(btrim(${table.reason})) between 1 and 500)`,
    ),
  ],
);

// A grade register (OOC-180, decisions of 23/11/2026 with Miguel — to confirm
// with the owner): one module run's grades for one round of the module. The
// teacher sends it to review, coordination returns it with a note or confirms
// it, and its grades become official. A run gets a new round when its
// register is official and grades are posted again — the repeaters' new
// attempt, or a student moved in later. Status is the row's; who did each
// step, and when, is `grade_register_events`.
export const gradeRegisters = pgTable(
  "grade_registers",
  {
    id: uuidPk(),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    classGroupModuleId: uuid("class_group_module_id").notNull(),
    round: integer("round").notNull(),
    // draft (Sin enviar) → in_review → returned → in_review … → official.
    status: text("status").notNull().default("draft"),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "grade_registers_class_group_module_fk",
      columns: [table.classGroupModuleId, table.classGroupId],
      foreignColumns: [classGroupModules.id, classGroupModules.classGroupId],
    }).onDelete("restrict"),
    check("grade_registers_round_check", sql`${table.round} > 0`),
    check("grade_registers_status_check", sql`${table.status} in ('draft', 'in_review', 'returned', 'official')`),
    uniqueIndex("grade_registers_run_round_uidx").on(table.classGroupModuleId, table.round),
    // One open register per run: the round that is being graded now.
    uniqueIndex("grade_registers_run_open_uidx")
      .on(table.classGroupModuleId)
      .where(sql`${table.status} <> 'official'`),
    index("grade_registers_class_group_id_idx").on(table.classGroupId),
  ],
);

// Each step of a register (OOC-180), append-only: who sent it to review, who
// returned it and why, who confirmed it. `module_ends_on` is the run's end
// date as it stood when the register was sent — what "sent late" is judged by
// after the date is moved for the next round.
export const gradeRegisterEvents = pgTable(
  "grade_register_events",
  {
    id: uuidPk(),
    registerId: uuid("register_id")
      .notNull()
      .references(() => gradeRegisters.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    note: text("note"),
    moduleEndsOn: date("module_ends_on", { mode: "string" }),
    // Better Auth's "user" is not modelled here; FK written by hand.
    actorId: text("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("grade_register_events_kind_check", sql`${table.kind} in ('submitted', 'returned', 'confirmed')`),
    check(
      "grade_register_events_note_check",
      sql`(${table.kind} = 'returned' and length(btrim(${table.note})) between 1 and 1000) or (${table.kind} <> 'returned' and ${table.note} is null)`,
    ),
    index("grade_register_events_register_id_idx").on(table.registerId, table.createdAt),
  ],
);

// The teacher's "acta de notas" of an official register (OOC-176): what the
// teacher is paid against. Recorded on the first download — one per register
// — with the published template version and the data frozen then (teacher,
// class group, course, module, who confirmed). The PDF is never stored, and
// the counts (passed, failed, DA) are read from the grades on every print, so
// a grade corrected after official shows in the next download. Append-only
// (REVOKE + trigger, 0078). `recorded_by` is Better Auth's "user".id — FK
// written by hand in 0078.
export const gradeRegisterRecords = pgTable(
  "grade_register_records",
  {
    id: uuidPk(),
    registerId: uuid("register_id")
      .notNull()
      .references(() => gradeRegisters.id, { onDelete: "restrict" }),
    // The teacher of the acta, from the roster (never typed): the run's
    // teacher when it was recorded. Scopes the teacher portal's downloads, so
    // a run handed to somebody else later does not hand them this acta.
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "restrict" }),
    templateVersionId: uuid("template_version_id").notNull(),
    data: jsonb("data").notNull(),
    recordedBy: text("recorded_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("grade_register_records_register_uidx").on(table.registerId),
    foreignKey({
      name: "grade_register_records_template_version_fk",
      columns: [table.templateVersionId],
      foreignColumns: [documentTemplateVersions.id],
    }).onDelete("restrict"),
  ],
);

// The grade that counts for each graded seat (OOC-102): the last correction
// when there is one, the posted grade otherwise. A view written by hand in
// 0052, so every reader — the teacher's sheet, the backoffice and the
// student's portal — agrees on which one that is.
export const currentGrades = pgView("current_grades", {
  gradeId: uuid("grade_id").notNull(),
  enrollmentId: uuid("enrollment_id").notNull(),
  classGroupId: uuid("class_group_id").notNull(),
  // The run, resolved for grades posted before 0059 (OOC-156), and the attempt.
  classGroupModuleId: uuid("class_group_module_id").notNull(),
  attempt: integer("attempt").notNull(),
  score: numeric("score", { precision: 4, scale: 2, mode: "number" }),
  didNotSit: boolean("did_not_sit").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  correctionId: uuid("correction_id"),
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  correctedBy: text("corrected_by"),
  // The register the grade was posted into, its status, and whether the grade
  // counts as official (OOC-180, 0074): no register, or an official one.
  registerId: uuid("register_id"),
  registerStatus: text("register_status"),
  official: boolean("official").notNull(),
}).existing();

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

// A guardian's door to a child's file (OOC-147). The child keeps their own
// account (`students.user_id`, the Gmail); this row lets the guardian's
// account reach the same file as one more profile. Written at approval time
// for a minor with a guardian on file.
//
// The row alone grants nothing: the API reaches the file only while the
// file's live guardian still has the same e-mail as this account
// (`reachableStudentIdsSql`). Changing or removing the guardian on the file
// cuts the access with no write here — which is why there is no `deleted_at`
// and nothing ever deletes a row.
//
// `user_id` is Better Auth's "user".id (text); its FK is hand-written in the
// migration, as in 0022.
export const guardianPortalLinks = pgTable(
  "guardian_portal_links",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("guardian_portal_links_user_student_uidx").on(table.userId, table.studentId),
    index("guardian_portal_links_student_id_idx").on(table.studentId),
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

// A backup restored by the owners' own area of the backoffice (OOC-153).
//
// The restore never touches the database the platform runs on: every row is
// a scratch database created for it (local only for now — production does
// not restore, 28/11/2026), loaded from one `ooc-prod-*.sql.gz` in the
// backups bucket and then checked. A restore whose checks fail has its database dropped on the spot;
// one that passes keeps it until an owner discards it. Pointing production at
// a restored database stays a manual step (docs/RESTAURAR-BACKUP.md).
//
// One open restore at a time — queued, running, or passed and not yet
// discarded — held by the partial unique index on a constant: the restored
// database is real student data (Ley 29733), and two of them lying around is
// one more than anybody is watching.
//
// `report` holds the checks the worker ran (counts, migrations, the
// append-only lock) — numbers and check names only, never a row's content.
// `requested_by` / `discarded_by` point at Better Auth's "user"; the FKs are
// written by hand in the migration, as for receipt_rereads.requested_by.
export const backupRestores = pgTable(
  "backup_restores",
  {
    id: uuidPk(),
    backupKey: text("backup_key").notNull(),
    databaseName: text("database_name").notNull().unique(),
    status: text("status").notNull().default("queued"),
    failureReason: text("failure_reason"),
    report: jsonb("report"),
    requestedBy: text("requested_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: text("discarded_by"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("backup_restores_one_open_uidx")
      .on(sql`(true)`)
      .where(sql`${table.status} in ('queued', 'restoring', 'validating', 'passed')`),
    index("backup_restores_created_at_idx").on(table.createdAt),
    check(
      "backup_restores_status_check",
      sql`${table.status} in ('queued', 'restoring', 'validating', 'passed', 'failed', 'discarded')`,
    ),
    // A failed restore always says why, and only a failed one does.
    check("backup_restores_failure_check", sql`(${table.status} = 'failed') = (${table.failureReason} is not null)`),
    check(
      "backup_restores_discard_check",
      sql`(${table.status} = 'discarded') = (${table.discardedAt} is not null) and (${table.discardedAt} is null) = (${table.discardedBy} is null)`,
    ),
  ],
);

// A demo access the owners opened (28/11/2026, apps/api CLAUDE.md, "Contas
// demo"): one per e-mail asked for, with the rows written for it — a demo
// class group, and the demo student or teacher inside it — so the NR Labs
// area can list them and revoke one. Revoking blocks the account and retires
// the class group; nothing is deleted.
export const demoAccesses = pgTable(
  "demo_accesses",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    classGroupId: uuid("class_group_id")
      .notNull()
      .references(() => classGroups.id, { onDelete: "restrict" }),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "restrict" }),
    teacherId: uuid("teacher_id").references(() => teachers.id, { onDelete: "restrict" }),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    ...timestamps(),
  },
  (table) => [
    check("demo_accesses_kind_check", sql`${table.kind} in ('student', 'teacher')`),
    // A student access points at its student, a teacher access at its teacher.
    check(
      "demo_accesses_owner_check",
      sql`(${table.kind} = 'student' and ${table.studentId} is not null and ${table.teacherId} is null) or (${table.kind} = 'teacher' and ${table.teacherId} is not null and ${table.studentId} is null)`,
    ),
    check("demo_accesses_revoke_check", sql`(${table.revokedAt} is null) = (${table.revokedBy} is null)`),
    index("demo_accesses_created_at_idx").on(table.createdAt),
  ],
);

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
    // What the provider reported AFTER accepting the message (OOC-91) — a
    // different question from `status`, which is whether we handed it over.
    // The latest word, with `outbox_delivery_events` holding the history; null
    // until the webhook says anything (and forever, without a webhook).
    deliveryStatus: text("delivery_status"),
    deliveryStatusAt: timestamp("delivery_status_at", { withTimezone: true }),
    // A proof somebody sent from the e-mail screen (OOC-89): sample data to a
    // staff address, with the subject marked. Kept out of every figure about
    // what the platform sent to students, and out of the resend list.
    isProof: boolean("is_proof").notNull().default(false),
    // The published version of the wording the worker rendered (OOC-60) —
    // written when the row is sent. Null: the repository's words went out.
    templateVersionId: uuid("template_version_id").references(() => emailTemplateVersions.id, {
      onDelete: "restrict",
    }),
    // A proof of a draft (OOC-60): the draft's words in the row's language,
    // frozen when the proof was asked for. Only on proofs (CHECK).
    templateCopy: jsonb("template_copy"),
    // The same message sent a second way, as a push to the devices the
    // recipient's portal account turned it on for (OOC-51). Null: this row is
    // never pushed (not a journey e-mail, a proof, a resend). Set to `pending`
    // by the writer with the row itself; the push worker claims it
    // (`sending`) before sending, so a job that runs twice never pushes twice.
    // Independent of `status`: the e-mail and the push each go their own way.
    pushStatus: text("push_status"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("outbox_dedupe_key_uidx").on(table.dedupeKey),
    check(
      "outbox_push_status_check",
      sql`${table.pushStatus} is null or ${table.pushStatus} in ('pending', 'sending', 'sent', 'no_device', 'blocked', 'failed')`,
    ),
    // The push relay's only query: the recent rows still waiting for a push.
    index("outbox_push_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.pushStatus} = 'pending'`),
    check(
      "outbox_delivery_status_check",
      sql`${table.deliveryStatus} is null or ${table.deliveryStatus} in ('delivered', 'soft_bounced', 'hard_bounced', 'blocked', 'unsubscribed')`,
    ),
    // The webhook finds its row by the id the send call returned. Brevo's send
    // API and its webhook spell the same id with and without the angle
    // brackets, so the lookup compares without them.
    index("outbox_provider_message_id_idx")
      .on(sql`trim(both '<>' from ${table.providerMessageId})`)
      .where(sql`${table.providerMessageId} is not null`),
    check("outbox_channel_check", sql`${table.channel} in ('email')`),
    check("outbox_locale_check", sql`${table.locale} in ('es-PE', 'pt-BR', 'en')`),
    // pending → sent | blocked | failed. `blocked` is the allowlist guard
    // refusing a recipient outside production (CLAUDE.md §6) — a decision,
    // not an error, so it is never retried.
    check("outbox_status_check", sql`${table.status} in ('pending', 'sent', 'blocked', 'failed')`),
    check("outbox_attempts_check", sql`${table.attempts} >= 0`),
    check("outbox_template_copy_check", sql`${table.templateCopy} is null or ${table.isProof}`),
    // The relay's only query: the oldest pending rows first.
    index("outbox_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

// The devices a portal account turned push notifications on for (OOC-51) —
// one row per browser subscription. `endpoint` is the push service's URL for
// that browser (unique: a device that changes hands follows the account that
// subscribed last); `p256dh` and `auth` are the browser's keys the payload is
// encrypted to. Not history: turning push off, or the push service saying the
// subscription is gone (404/410), deletes the row.
//
// `user_id` is Better Auth's "user".id (text); its FK is hand-written in the
// migration, as in 0022.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuidPk(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_uidx").on(table.endpoint),
    index("push_subscriptions_user_id_idx").on(table.userId),
  ],
);

// What the e-mail provider reported about a message after taking it (OOC-91):
// one row per webhook event, append-only — a soft bounce followed by a
// delivery is a story, and `outbox.delivery_status` only keeps its last line.
//
// `dedupe_key` is `<message id>:<event>:<provider timestamp>`: Brevo retries a
// webhook it did not see answered, and replaying the same event is a no-op.
//
// `reason` is a closed code classified from the provider's free text, never the
// text itself — it can echo the address back (CLAUDE.md §6, "PII em log"), the
// same rule as `outbox.last_error`.
export const outboxDeliveryEvents = pgTable(
  "outbox_delivery_events",
  {
    id: uuidPk(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => outbox.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    reason: text("reason"),
    dedupeKey: text("dedupe_key").notNull(),
    // When the provider says it happened — not when the webhook arrived.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("outbox_delivery_events_dedupe_key_uidx").on(table.dedupeKey),
    check(
      "outbox_delivery_events_kind_check",
      sql`${table.kind} in ('delivered', 'soft_bounce', 'hard_bounce', 'blocked', 'unsubscribed')`,
    ),
    check(
      "outbox_delivery_events_reason_check",
      sql`${table.reason} is null or ${table.reason} in ('mailbox_full', 'address_unknown', 'domain_invalid', 'blocked_by_server', 'other')`,
    ),
    // The 30-day metrics count by kind over a window.
    index("outbox_delivery_events_kind_occurred_at_idx").on(table.kind, table.occurredAt),
    index("outbox_delivery_events_outbox_id_idx").on(table.outboxId),
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
    // Retired by OOC-83: the price lives in procedure_prices, versioned, and
    // nothing reads this. Goes in the contract step (CLAUDE.md §7).
    constanciaFeeCents: integer("constancia_fee_cents").notNull().default(2500),
    // OOC-41: how early a teacher's contract starts warning. 45 is
    // provisional (CLAUDE.md §1).
    contractAlertDays: integer("contract_alert_days").notNull().default(45),
    // OOC-180: hours after the module's end date to send the grade register
    // to review before it reads "out of time". 48 today.
    gradeSubmissionHours: integer("grade_submission_hours").notNull().default(48),
    // OOC-58: business days (Monday to Friday in Lima, no holidays yet) the
    // company has to answer a complaints book sheet. 15 is DS 101-2022-PCM's
    // rule, to be confirmed with the owner.
    complaintResponseBusinessDays: integer("complaint_response_business_days").notNull().default(15),
    // OOC-156: advancing a student to the next module asks for the pass mark.
    // Coordination may still advance below it, with a reason; off, any posted
    // grade lets the student advance.
    progressionRequiresPassingGrade: boolean("progression_requires_passing_grade").notNull().default(true),
    // OOC-196: how many teachers may share one Classroom account at a time.
    // 7 is the client's number (high season, 3–7 per account).
    classroomAccountMaxTeachers: integer("classroom_account_max_teachers").notNull().default(7),
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
    check(
      "platform_settings_grade_submission_hours_check",
      sql`${table.gradeSubmissionHours} between 1 and 720`,
    ),
    check(
      "platform_settings_complaint_response_business_days_check",
      sql`${table.complaintResponseBusinessDays} between 1 and 60`,
    ),
    check(
      "platform_settings_classroom_account_max_teachers_check",
      sql`${table.classroomAccountMaxTeachers} between 1 and 50`,
    ),
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

// ---------------------------------------------------------------------------
// Editable e-mail wording (OOC-60)
// ---------------------------------------------------------------------------

// The workbench: one draft per e-mail template, rewritten on every save and
// allowed to be wrong. `content` is the template's words per language (the
// same blocks as packages/notifications/src/locales). `updated_by` is Better
// Auth's "user".id — FK written by hand in 0082.
export const emailTemplateDrafts = pgTable(
  "email_template_drafts",
  {
    id: uuidPk(),
    templateKey: text("template_key").notNull(),
    content: jsonb("content").notNull(),
    updatedBy: text("updated_by").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("email_template_drafts_template_key_uidx").on(table.templateKey)],
);

// What the send-email worker reads: append-only (0082 lock), numbered per
// template. The one in force is the highest `version`; without one, the
// repository's words go out. `repository_version` is the repository wording's
// fingerprint at publish time, so the editor can say the code changed since.
// `published_by` is Better Auth's "user".id — FK written by hand in 0082.
export const emailTemplateVersions = pgTable(
  "email_template_versions",
  {
    id: uuidPk(),
    templateKey: text("template_key").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    repositoryVersion: text("repository_version").notNull(),
    publishedBy: text("published_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("email_template_versions_template_key_version_uidx").on(table.templateKey, table.version),
    check("email_template_versions_version_check", sql`${table.version} > 0`),
  ],
);

// A document the institution issued (OOC-33): the constancia of a paid
// procedure request and the course certificate. Never a file anybody uploaded
// (`documents`, OOC-143) — this one carries a verification code, and the
// public validation page (OOC-59) reads it. The PDF is never stored: it prints
// again from the template version and the data frozen here on issue, so a
// corrected file never rewrites a document already handed out.
// Append-only (REVOKE + trigger, 0062): an issued document is history.
// `issued_by` is Better Auth's "user".id — FK written by hand in 0062; null
// when the platform issued it on its own (the constancia, once its payment is
// approved).
export const issuedDocuments = pgTable(
  "issued_documents",
  {
    id: uuidPk(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "restrict" }),
    // The constancia's paid request; null on a certificate.
    procedureRequestId: uuid("procedure_request_id").references(() => procedureRequests.id, { onDelete: "restrict" }),
    // The certificate's module group — the course's last module, where the
    // batch was confirmed; null on a constancia.
    // FKs named in the table's options below: the generated names pass
    // Postgres' 63 characters (as 0036's did).
    classGroupModuleId: uuid("class_group_module_id"),
    templateVersionId: uuid("template_version_id").notNull(),
    data: jsonb("data").notNull(),
    issuedBy: text("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    // The document this one was issued in place of (OOC-59): a certificate
    // issued again after the earlier one was revoked. The earlier row never
    // changes — "replaced" is read from this column.
    replacesId: uuid("replaces_id").references((): AnyPgColumn => issuedDocuments.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    check("issued_documents_kind_check", sql`${table.kind} in ('enrollment_certificate', 'certificate')`),
    check(
      "issued_documents_source_check",
      sql`(${table.kind} = 'enrollment_certificate') = (${table.procedureRequestId} is not null)
        and (${table.kind} = 'certificate') = (${table.classGroupModuleId} is not null)`,
    ),
    uniqueIndex("issued_documents_code_uidx").on(table.code),
    // One constancia per paid request, one certificate per enrollment.
    uniqueIndex("issued_documents_procedure_request_uidx")
      .on(table.procedureRequestId)
      .where(sql`${table.procedureRequestId} is not null`),
    // One first certificate per enrollment (OOC-33); a reissue (OOC-59)
    // replaces one document at most once, so the chain stays a line.
    uniqueIndex("issued_documents_certificate_first_uidx")
      .on(table.enrollmentId)
      .where(sql`${table.kind} = 'certificate' and ${table.replacesId} is null`),
    uniqueIndex("issued_documents_replaces_uidx")
      .on(table.replacesId)
      .where(sql`${table.replacesId} is not null`),
    index("issued_documents_student_id_idx").on(table.studentId),
    foreignKey({
      name: "issued_documents_class_group_module_fk",
      columns: [table.classGroupModuleId],
      foreignColumns: [classGroupModules.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "issued_documents_template_version_fk",
      columns: [table.templateVersionId],
      foreignColumns: [documentTemplateVersions.id],
    }).onDelete("restrict"),
  ],
);

// An issued document withdrawn by a person (OOC-59): the validation page
// answers "revoked" for its code from then on. Append-only like the document:
// a revocation is not undone — a certificate is issued again instead, and the
// new one points at this one (`issued_documents.replaces_id`). The reason is
// kept here, never in audit_log (it is free text about a person).
export const issuedDocumentRevocations = pgTable(
  "issued_document_revocations",
  {
    id: uuidPk(),
    issuedDocumentId: uuid("issued_document_id")
      .notNull()
      .references(() => issuedDocuments.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    // Better Auth's "user" is not modelled here; FK written by hand in 0071.
    revokedBy: text("revoked_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("issued_document_revocations_document_uidx").on(table.issuedDocumentId),
    check("issued_document_revocations_reason_check", sql`length(btrim(${table.reason})) between 1 and 500`),
  ],
);

// A file someone sent to the platform (OOC-143): one bucket, one key per row,
// and the key is the row's id (`documents/<id>`) — the name the person gave the
// file lives only here, never in the bucket. Generic on purpose: `owner_type`
// + `owner_id` say whose file it is (a student today; a teacher, an enrollment
// or a payment later), with no FK, because the owner can be any of them. The
// set of owner types and categories is the domain's (`ATTACHMENT_OWNER_TYPES`,
// `ATTACHMENT_CATEGORIES`), not a CHECK: a new kind of owner must not cost a
// migration, as with `courses.landing_key` (0028).
//
// Never an issued document: an uploaded file carries no verification code.
// `uploaded_by` and `removed_by` are Better Auth's "user".id — FKs written by
// hand in 0048. `size_bytes`, `checksum_sha256` and `uploaded_at` arrive with
// the confirm step, which reads what actually landed in the bucket.
export const documents = pgTable(
  "documents",
  {
    id: uuidPk(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    category: text("category").notNull(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    // What the client declared until the confirm step, then what the file's
    // own bytes say it is.
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    checksumSha256: text("checksum_sha256"),
    source: text("source").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    status: text("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    removedBy: text("removed_by"),
    ...softDeletable(),
  },
  (table) => [
    uniqueIndex("documents_object_key_uidx").on(table.objectKey),
    check("documents_status_check", sql`${table.status} in ('pending', 'uploaded', 'rejected', 'removed')`),
    check("documents_source_check", sql`${table.source} in ('portal', 'backoffice')`),
    check("documents_size_bytes_check", sql`${table.sizeBytes} is null or ${table.sizeBytes} > 0`),
    // Uploaded (and removed after it) carries what the bucket holds.
    check(
      "documents_uploaded_check",
      sql`(${table.status} in ('uploaded', 'removed')) = (${table.uploadedAt} is not null and ${table.sizeBytes} is not null and ${table.checksumSha256} is not null)`,
    ),
    check(
      "documents_rejection_check",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} is not null)`,
    ),
    // Removed is the only retirement there is, and it says who.
    check(
      "documents_removed_check",
      sql`(${table.status} = 'removed') = (${table.deletedAt} is not null) and (${table.status} = 'removed') = (${table.removedBy} is not null)`,
    ),
    // The owner's list: live files, newest first.
    index("documents_owner_idx")
      .on(table.ownerType, table.ownerId, table.createdAt)
      .where(sql`${table.status} = 'uploaded' and ${table.deletedAt} is null`),
    // The sweep's only query: uploads never confirmed.
    index("documents_pending_idx").on(table.createdAt).where(sql`${table.status} = 'pending'`),
  ],
);

// The reports' nightly aggregation (OOC-40). Derived data, never a record of
// anything: the `report-refresh` worker rebuilds all three in one transaction
// (delete + insert … select), so a reader sees last night's figures or the new
// ones, never half of each. Keyed by module run — the finest grain a report
// cuts by (the run carries the teacher, its class group the course and the
// period) — and holding counts only: names are joined on read, so renaming a
// course or allocating a teacher shows at once. Money is `bigint` cents
// because it is a sum of many `amount_cents` (CLAUDE.md §6), never a float.

/** Per run: seats, money and grades as they stood at the refresh. */
export const reportRunFacts = pgTable("report_run_facts", {
  classGroupModuleId: uuid("class_group_module_id")
    .primaryKey()
    .references(() => classGroupModules.id, { onDelete: "restrict" }),
  /** Confirmed, unretired seats — the ledger's own count (OOC-55). */
  enrollments: integer("enrollments").notNull(),
  /** Seats still held while the payment is open. */
  reserved: integer("reserved").notNull(),
  /** Approved money paying for the run's enrollments. */
  collectedCents: bigint("collected_cents", { mode: "number" }).notNull(),
  /** Money still open — pending or under review. A rejection is not owed. */
  pendingCents: bigint("pending_cents", { mode: "number" }).notNull(),
  /** How many enrollments make up `pending_cents`. */
  pendingCount: integer("pending_count").notNull(),
  /** Current grades below the passing grade in force at the refresh, DA included. */
  lowGrades: integer("low_grades").notNull(),
});

/** Per run and Lima month: enrollments by first approval, money by decision. */
export const reportMonthFacts = pgTable(
  "report_month_facts",
  {
    classGroupModuleId: uuid("class_group_module_id")
      .notNull()
      .references(() => classGroupModules.id, { onDelete: "restrict" }),
    /** First day of the month, Lima calendar. */
    month: date("month", { mode: "string" }).notNull(),
    enrollments: integer("enrollments").notNull(),
    collectedCents: bigint("collected_cents", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.classGroupModuleId, table.month] })],
);

/** Per class group: the seat counters as they stood at the refresh. */
export const reportClassGroupFacts = pgTable("report_class_group_facts", {
  classGroupId: uuid("class_group_id")
    .primaryKey()
    .references(() => classGroups.id, { onDelete: "restrict" }),
  /** `seats_taken + seats_over` — the "30 / 30 +2" of Académico (OOC-155). */
  seatsTaken: integer("seats_taken").notNull(),
  capacity: integer("capacity").notNull(),
});

/** One row per refresh: when the figures above were built. */
export const reportRefreshes = pgTable("report_refreshes", {
  id: uuidPk(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull(),
});

// The complaints book (Libro de Reclamaciones, OOC-63): one row per sheet,
// filed from the public form by anybody — a student or not, so no FK to
// `students` (linking a sheet to a record by document is OOC-58's, on read).
// Append-only, like every record the platform promises to keep: a sheet is
// never edited nor removed, and the company's answer will be a row of its own.
// The supplier is frozen on the sheet (the company answering for the site has
// changed twice). `code` is drawn from `complaint_number_seq` in the insert —
// the year in Lima plus the sequence, which never restarts.
export const complaintNumberSeq = pgSequence("complaint_number_seq", { startWith: 1 });

export const complaints = pgTable(
  "complaints",
  {
    id: uuidPk(),
    code: text("code").notNull(),
    kind: text("kind").notNull(),
    supplierLegalName: text("supplier_legal_name").notNull(),
    supplierRuc: text("supplier_ruc").notNull(),
    supplierAddress: text("supplier_address").notNull(),
    consumerFirstName: text("consumer_first_name").notNull(),
    consumerLastName: text("consumer_last_name").notNull(),
    consumerSecondLastName: text("consumer_second_last_name"),
    consumerNationalIdType: text("consumer_national_id_type").notNull(),
    consumerNationalId: text("consumer_national_id").notNull(),
    consumerPhone: text("consumer_phone").notNull(),
    consumerEmail: text("consumer_email").notNull(),
    consumerDepartment: text("consumer_department").notNull(),
    consumerProvince: text("consumer_province").notNull(),
    consumerDistrict: text("consumer_district").notNull(),
    consumerAddress: text("consumer_address").notNull(),
    consumerAddressReference: text("consumer_address_reference"),
    consumerIsMinor: boolean("consumer_is_minor").notNull(),
    guardianFirstName: text("guardian_first_name"),
    guardianLastName: text("guardian_last_name"),
    guardianNationalIdType: text("guardian_national_id_type"),
    guardianNationalId: text("guardian_national_id"),
    goodType: text("good_type").notNull(),
    amountCents: integer("amount_cents"),
    purchasedOn: date("purchased_on", { mode: "string" }),
    description: text("description").notNull(),
    detail: text("detail").notNull(),
    request: text("request").notNull(),
    // Ley 29733: which notice was accepted, from where. The time is created_at.
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    consumerIp: text("consumer_ip").notNull(),
    // The language of the form — the copy went out in it, and so will the answer.
    locale: text("locale").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("complaints_code_uidx").on(table.code),
    uniqueIndex("complaints_idempotency_key_uidx").on(table.idempotencyKey),
    check("complaints_kind_check", sql`${table.kind} in ('claim', 'grievance')`),
    check("complaints_good_type_check", sql`${table.goodType} in ('product', 'service')`),
    check("complaints_amount_check", sql`${table.amountCents} is null or ${table.amountCents} >= 0`),
    check(
      "complaints_national_id_type_check",
      sql`${table.consumerNationalIdType} in ('DNI', 'CE', 'passport') and (${table.guardianNationalIdType} is null or ${table.guardianNationalIdType} in ('DNI', 'CE', 'passport'))`,
    ),
    check("complaints_locale_check", sql`${table.locale} in ('es-PE', 'pt-BR', 'en')`),
    // A minor files through a guardian, and only a minor carries one: the
    // guardian's four columns are there together, exactly when the consumer is a minor.
    check(
      "complaints_guardian_check",
      sql`${table.consumerIsMinor} = (${table.guardianFirstName} is not null) and num_nonnulls(${table.guardianFirstName}, ${table.guardianLastName}, ${table.guardianNationalIdType}, ${table.guardianNationalId}) in (0, 4)`,
    ),
    // The book read newest first (OOC-58's inbox).
    index("complaints_created_at_idx").on(table.createdAt),
  ],
);

// What the company did with a sheet (OOC-58), append-only like the sheet: a
// person took it (`taken`) and a person answered it (`answered`, with the
// answer the consumer got by e-mail). Each step happens once per sheet — the
// unique index decides two people clicking at once. The sheet's status is
// read from these rows, never stored: no row is "received". `actor_id` is
// Better Auth's "user".id — FK written by hand in 0079.
export const complaintEvents = pgTable(
  "complaint_events",
  {
    id: uuidPk(),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    answer: text("answer"),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("complaint_events_kind_check", sql`${table.kind} in ('taken', 'answered')`),
    check(
      "complaint_events_answer_check",
      sql`(${table.kind} = 'answered' and length(btrim(${table.answer})) between 1 and 5000) or (${table.kind} <> 'answered' and ${table.answer} is null)`,
    ),
    uniqueIndex("complaint_events_complaint_kind_uidx").on(table.complaintId, table.kind),
  ],
);
