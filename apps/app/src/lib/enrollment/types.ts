/**
 * Domain shapes for the public enrollment checkout (mockup phase).
 *
 * Same treatment as the portal and backoffice type files: these mirror the
 * future database rows named in `CLAUDE.md` §4, so swapping the mock source for
 * real queries later touches the data layer and not a single component.
 *
 * Money is integer cents, always (`CLAUDE.md` §5). Nothing here carries UI
 * copy — every label is resolved from the `enrollment` i18n namespace.
 */

import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type { NationalIdType, PaymentRail } from '@/lib/portal/types'

export type { NationalIdType, PaymentRail }

/**
 * Weekday code, resolved to a label by the locale. Declared here rather than
 * imported from the backoffice: this is a public route, and a page anyone can
 * open should not reach into the staff panel's module for a seven-value union.
 * Same codes as `lib/backoffice/types.ts` on purpose — they name the same days.
 */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type GuardianRelationship = 'mother' | 'father' | 'legal_guardian'

/**
 * Where the enrollment came from (`CLAUDE.md` §5, "Origem da matrícula").
 *
 * A closed union, never free text off the query string: anything we do not
 * recognise is `web`. It is a domain field on the enrollment — not an analytics
 * event — because coordination has to answer "how much of this cycle came from
 * WhatsApp" inside the backoffice, and edge analytics dies to an ad blocker.
 */
export type EnrollmentSource = 'whatsapp' | 'web'

/* -------------------------------------------------------------------------- */
/* Public catalog — what the first step can offer                             */
/* -------------------------------------------------------------------------- */

/**
 * A language the Asociación teaches. Catalog data, never a translated enum:
 * they run ~10 languages and open new ones (quechua workshops included), and
 * `CLAUDE.md` §1 is explicit that nothing language-specific belongs in code.
 */
export interface CatalogLanguage {
  id: string
  name: string
}

export interface CatalogCourse {
  id: string
  languageId: string
  name: string
  /** Catalog label ("Básico", "A1", "Kids") — data, not an enum. */
  level: string
  /** Minimum age (`docs/REGRAS-NEGOCIO.md` §2). A hard gate on step 2. */
  minAge: number
  modules: number
  totalHours: number
  /** Which landing page sells it — `?course=` from the static landing (OOC-117). */
  landingKey: LandingCourseKey | null
}

/**
 * The package being bought. Price is versioned and never edited: the enrollment
 * freezes `planPriceId` (`CLAUDE.md` §5), so the checkout shows the version in
 * force and carries its id, rather than carrying a number it could re-derive.
 */
export interface CatalogPlan {
  id: string
  courseId: string
  name: string
  planPriceId: string
  amountCents: number
  currency: 'PEN'
}

/**
 * One weekly session. A class group is a list of these rather than a set of
 * weekdays sharing one time, because they do not: a group can meet Tuesday
 * 09:00–13:00 and Thursday 06:30–08:30. Same shape the portal already uses
 * (`lib/portal/types.ts`, `WeeklySlot`).
 */
export interface WeeklySlot {
  weekday: Weekday
  /** "HH:mm" in America/Lima. */
  startTime: string
  endTime: string
}

/** A turma. Never `class` — reserved word (`CLAUDE.md` §4 glossary). */
export interface CatalogClassGroup {
  id: string
  courseId: string
  /**
   * The code the institution prints on paperwork. Carried, but never shown in
   * the checkout: it means nothing to somebody enrolling for the first time,
   * and it was crowding the one thing the card exists to say — when the class
   * meets.
   */
  code: string
  teacherName: string
  slots: WeeklySlot[]
  startDate: string
  endDate: string
  capacity: number
  seatsTaken: number
}

/**
 * Where to send the money. There is no payment gateway in the platform
 * (`CLAUDE.md` §2) — the checkout shows the account and receives the proof.
 *
 * A **rail**, never a `PaymentMethod`: `other` is the backoffice's escape
 * hatch for a deposit that arrived through a bank nobody listed, recorded
 * after the fact. A public checkout cannot offer it — there would be no
 * account to show and no number to copy — so the type says so.
 */
export interface PaymentAccount {
  method: PaymentRail
  /** Legal holder of the account, as it appears in the banking app. */
  holder: string
  /** The number the payer types or copies: phone for Yape, account for a bank. */
  number: string
  /** Interbank transfer code, when the rail has one. */
  interbankCode: string | null
  /**
   * Whether this rail is paid by scanning. Yape is; a bank transfer is not,
   * and showing a code beside an account number invites somebody to try to
   * scan the wrong thing.
   */
  hasQr: boolean
}

/**
 * The two clocks of a seat (`CLAUDE.md` §5). Both are backoffice parameters,
 * never constants in code — same reasoning as the amount tolerance.
 */
export interface CheckoutSettings {
  /** Minutes a seat is held while the person goes off to pay. */
  holdMinutes: number
  /** Days a submitted enrollment keeps its seat waiting for approval. */
  reservationDays: number
  /** Ceiling for the receipt upload, enforced again server-side. */
  maxReceiptBytes: number
  /** Version of the consent text in force (Ley 29733, `CLAUDE.md` §8). */
  consentVersion: string
}

export interface PublicCatalog {
  languages: CatalogLanguage[]
  courses: CatalogCourse[]
  plans: CatalogPlan[]
  classGroups: CatalogClassGroup[]
  accounts: PaymentAccount[]
  settings: CheckoutSettings
}

/* -------------------------------------------------------------------------- */
/* Wizard state — what the four steps collect                                 */
/* -------------------------------------------------------------------------- */

export type StepId = 'course' | 'student' | 'payment' | 'review'

export const STEP_ORDER: readonly StepId[] = [
  'course',
  'student',
  'payment',
  'review',
]

export interface CourseDraft {
  languageId: string | null
  courseId: string | null
  /**
   * Chosen before the schedule, and separately from it. The same course opens
   * on several dates — start today or with the class group at the end of the
   * month — and each date carries its own three or four schedules
   * (`docs/MATRICULA-CHECKOUT.md` §2). Collapsing the two into one long list
   * is how somebody picks a good time on the wrong date.
   */
  startDate: string | null
  classGroupId: string | null
}

/**
 * The student, in the shape the Asociación already collects
 * (`docs/MATRICULA-CHECKOUT.md` §2 carries the column list of the sheet this
 * replaces). One of these is not obvious:
 *
 * - `phone` IS asked here. The "never ask for a phone number" rule
 *   (`docs/REGRAS-NEGOCIO.md` §5) governs the WhatsApp sales conversation,
 *   where the number is already known — not the enrollment form, which has
 *   always had a CELULAR column.
 *
 * `firstName`/`lastName` (`docs/ROADMAP.md` Sessão 21a, resolved this way):
 * two fields, matching `students.first_name`/`last_name` and the backoffice's
 * own manual registration form — a single `fullName` field pushed the
 * ambiguity of a compound Peruvian name onto the server, which has no more
 * information to resolve it with than the form already had.
 */
export interface StudentDraft {
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  /** Mobile number, as the sheet's CELULAR column. */
  phone: string
  /**
   * Must be a personal Gmail account belonging to the student: class access
   * arrives through Google Classroom, and the form is explicit that
   * institutional and corporate addresses are refused.
   */
  email: string
  birthDate: string
  /**
   * Peru only here — the public form has no country selector, unlike the
   * backoffice's manual registration (`lib/geo.ts` PERU_REGIONS). Null only
   * before the first choice; `students.region`/`.city` back the "matrículas
   * por región" reporting (`docs/ROADMAP.md` Sessão 39), so this is real
   * data collected up front, not a value invented at submit.
   */
  region: string | null
  city: string
}

/**
 * Filled only when the student is under age. Most of the public is
 * (`CLAUDE.md` §1), so this is the normal path, not the exception — and the
 * consent it carries is a legal record, not a checkbox.
 */
export interface GuardianDraft {
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  relationship: GuardianRelationship
  phone: string
  /** No Gmail constraint here: Classroom access belongs to the student. */
  email: string
  /** Typed twice: no code proves this address (spec 2026-10-07), so a typo
   * here is caught only by the reader agreeing with themselves. */
  emailConfirmation: string
  consentAccepted: boolean
}

/**
 * The receipt as the browser knows it. The file itself never travels through
 * our function — it goes straight to storage on a signed URL (`CLAUDE.md` §5),
 * so what the wizard state keeps is the description, not the bytes.
 *
 * `receiptUploadId` only exists once the direct-to-bucket PUT and the
 * confirm both succeeded (`RequestReceiptUploadRoute` /
 * `ConfirmReceiptUploadRoute`, OOC-19) — it is what the submit sends, not the
 * file description. A `ReceiptDraft` the reader sees attached but whose
 * upload never confirmed does not carry one, and the step blocks on it the
 * same way it blocks on a missing `operationNumber`.
 */
export interface ReceiptDraft {
  fileName: string
  sizeBytes: number
  /** Object URL for the local preview; not persisted across a reload. */
  previewUrl: string | null
  receiptUploadId: string | null
}

export interface PaymentDraft {
  /** Only a rail the Asociación publishes an account for — see `PaymentAccount`. */
  method: PaymentRail | null
  operationNumber: string
  receipt: ReceiptDraft | null
}

/**
 * The student's e-mail, proven with the 6-digit code on this checkout's seat
 * hold (spec 2026-10-07). Kept so a reload does not ask for the code again;
 * it only counts while both the hold and the address still match.
 */
export interface EmailVerificationProof {
  holdId: string
  email: string
}

export interface CheckoutDraft {
  course: CourseDraft
  student: StudentDraft
  guardian: GuardianDraft
  payment: PaymentDraft
  emailVerification: EmailVerificationProof | null
  /** Resolved once, on first arrival, and carried to submit. */
  source: EnrollmentSource
  /** Campaign parameters, kept apart from the business field, for reporting. */
  campaign: Record<string, string>
}

/**
 * The seat hold, as the server issued it. The countdown on screen reads this;
 * it does not own it — a client-side clock is comfort, never authority
 * (`docs/MATRICULA-CHECKOUT.md` §3).
 */
export interface SeatHold {
  /** The server's hold — what the submit consumes and a release names. */
  id: string
  classGroupId: string
  /**
   * ISO 8601 UTC instant at which the seat goes back to the class group, on
   * this device's clock: the server's `secondsLeft` added to the local time it
   * arrived at, so a phone set to the wrong time still counts down correctly.
   */
  expiresAt: string
}

/** How asking the server for a seat can end. */
export type HoldOutcome = 'held' | 'full' | 'failed'
