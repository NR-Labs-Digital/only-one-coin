/**
 * Domain shapes for the student portal UI, filled from `GET /portal/overview`
 * by `lib/portal/session.ts` (OOC-32). Same names and enums as the database
 * rows (CLAUDE.md §4 glossary). Parts with no backend yet — modules, monthly
 * billing, documents, requests, notices, offers — keep their shape here and
 * arrive empty until the ticket that builds them.
 *
 * Money is always integer cents (CLAUDE.md §5: `amount_cents INTEGER`, never
 * float). Timestamps are ISO 8601 UTC strings; the UI renders them in
 * America/Lima. Human-facing copy (labels, statuses) is NOT stored here — it is
 * resolved from the `portal` i18n namespace via enum keys.
 *
 * Everything is online (CLAUDE.md §1): there is no modality field anywhere —
 * a class is a Google Meet link, and offering anything else on screen is a
 * content bug, not a feature.
 */

export type Locale = 'es' | 'en' | 'pt'

export type NationalIdType = 'DNI' | 'CE' | 'passport'

/** Payment state machine — CLAUDE.md §5: pending → under_review → approved | rejected. */
export type PaymentStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'

/**
 * The rails the institution is paid through — lowercase codes, never translated
 * (CLAUDE.md §4 glossary).
 */
export type PaymentRail = 'yape' | 'plin' | 'bcp' | 'interbank'

/**
 * A rail, or anything else the money arrived by. `other` is not a fifth brand:
 * it is the escape hatch for the deposit that came through a bank nobody
 * listed, and it carries no label of its own — whoever records it writes what
 * it was, and that text is the label (see `formatPaymentMethod`).
 */
export type PaymentMethod = PaymentRail | 'other'

/** Seat lifecycle — CLAUDE.md §5: reserved → confirmed → released. */
export type SeatStatus = 'reserved' | 'confirmed' | 'released'

/**
 * Enrollment status shown to the student. `frozen` is the paid congelamento
 * (decision 02/09/2026): the student pauses and later returns at the exact
 * module where they stopped — never a debt, never an expiry.
 */
export type EnrollmentStatus =
  | 'under_review'
  | 'active'
  | 'frozen'
  | 'completed'
  | 'rejected'

/**
 * How this enrollment is paid (decision 02/09/2026). Every course sells the
 * package as a single payment; only English also offers `monthly` — a prepaid
 * purchase of one module at a time. Monthly is NOT an installment plan of the
 * package: no interest, no late fee, no debt. An unpaid month simply locks
 * class access in the portal (see `ClassAccessLock`).
 */
export type BillingMode = 'package' | 'monthly'

export type ModuleStatus = 'completed' | 'current' | 'upcoming'

/**
 * Why the "join class" option is locked in the portal. The lock IS the portal
 * option, never a Google Classroom integration (out of scope, CLAUDE.md §2):
 * `monthly_payment_due` — the current module's prepaid month wasn't paid;
 * `module_failed` — the student didn't pass and doesn't move on with the batch
 * (module progression decision, 02/09/2026).
 */
export type ClassAccessLock = 'monthly_payment_due' | 'module_failed' | null

export type DocumentType = 'enrollment_certificate' | 'certificate'

export type DocumentStatus = 'available' | 'pending' | 'locked'

/**
 * Paid procedures the student starts from the portal (docs/REGRAS-NEGOCIO.md
 * §5). The free certificate is NOT here — it is issued per class group by the
 * coordination and lands in documents on its own.
 */
export type RequestType =
  | 'enrollment_certificate'
  | 'certification_exam'
  | 'makeup_exam'
  | 'enrollment_freeze'

/**
 * A request is born with its receipt (same ladder as enrollment: OCR → human
 * queue) — so it never sits waiting for a payment to be attached:
 * `under_review` — receipt being validated; `in_progress` — payment approved,
 * coordination is working on it; `completed` — document delivered / freeze
 * applied; `rejected` — payment or request refused.
 */
export type RequestStatus =
  | 'under_review'
  | 'in_progress'
  | 'completed'
  | 'rejected'

export type NotificationKind =
  | 'monthly_payment_due'
  | 'document_ready'
  | 'next_level_invite'

export interface Guardian {
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  relationship: 'mother' | 'father' | 'legal_guardian'
  email: string
  phone: string
  /**
   * Ley 29733 consent — CLAUDE.md §8. The IP stays on the guardian's record;
   * the student's screen has no use for it.
   */
  consent: {
    version: string
    acceptedAt: string
  } | null
}

export interface Student {
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  /**
   * The Gmail that receives class access (CLAUDE.md §1) — locked on the
   * profile screen; changing it is a coordination flow, never self-service.
   */
  email: string
  phone: string
  birthDate: string
  /** Derived from birthDate; drives the guardian-consent flow (CLAUDE.md §1). */
  isMinor: boolean
  guardian: Guardian | null
}

/** A sellable package / plan. Price is versioned and frozen at enrollment. */
export interface Plan {
  /** Data, not UI copy — this is a catalog row, like a DB value. */
  name: string
  priceCents: number
  currency: 'PEN'
}

export interface AcademicPeriod {
  name: string
}

export interface WeeklySlot {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** "HH:mm" in America/Lima. */
  startTime: string
  endTime: string
}

/** A turma. Never `class` — reserved word (CLAUDE.md §4 glossary). */
export interface ClassGroup {
  name: string
  teacherName: string
  schedule: WeeklySlot[]
  /** Null only for a class group still without dates. */
  startDate: string | null
  endDate: string | null
  /**
   * The class group's Google Classroom, where the Meet lives — an external
   * link only, no video hosting in-platform (CLAUDE.md §2). The API sends it
   * only on a confirmed seat (OOC-98); null otherwise.
   */
  classroomUrl: string | null
}

export interface CourseMaterial {
  id: string
  title: string
  /** External link only. */
  url: string
  kind: 'doc' | 'video' | 'audio' | 'link'
}

/** One teachable block of a course. Catalog data, like the course name. */
export interface CourseModule {
  id: string
  name: string
  /** 1-based order within the course. */
  sequence: number
  startDate: string
  endDate: string
  status: ModuleStatus
}

export interface Course {
  name: string
  /** Short blurb — catalog data. */
  summary: string
  minAge: number
  level: string
  /**
   * Inglés Básico's certificate also demands the separately-requested
   * certification exam (CLAUDE.md §1). Documents copy reads this flag.
   */
  requiresCertificationExam: boolean
  /** External links only. Empty until materials have a backend (OOC-100). */
  materials: CourseMaterial[]
}

export interface Payment {
  id: string
  amountCents: number
  currency: 'PEN'
  method: PaymentMethod
  /** The free-text label when `method` is `other` (CLAUDE.md §4 glossary). */
  methodDetail: string | null
  status: PaymentStatus
  /** Provider operation number the student typed. */
  operationNumber: string | null
  /** When the payment (and its receipt) went in. */
  submittedAt: string
  /** When a person approved or rejected it; null while it waits. */
  settledAt: string | null
  /**
   * A processed receipt exists, so the student can open it again. Never a
   * link of its own: the bucket is private, and the portal asks the API for a
   * 5-minute URL scoped to the student only when they click — every opening
   * is logged (CLAUDE.md §8).
   */
  hasReceipt: boolean
}

/**
 * One prepaid month of a monthly (English) enrollment. `payment` is null until
 * the student uploads the receipt from the portal — that null is exactly what
 * the reminder e-mail and the portal notice point at, and what locks class
 * access once `dueDate` passes. Never a debt (CLAUDE.md §1).
 */
export interface ModulePayment {
  moduleId: string
  dueDate: string
  payment: Payment | null
}

export interface MonthlyBilling {
  /**
   * Current price of one module — the amount the next receipt must match.
   * Read-only on every screen: there are no discounts, ever (CLAUDE.md §1).
   */
  modulePriceCents: number
  currency: 'PEN'
  payments: ModulePayment[]
}

export interface Enrollment {
  id: string
  /**
   * Human-readable enrollment code the student quotes for support — the same
   * tracking code the ledger shows (`OOC-2026-1188`), derived server-side;
   * the internal `id` never reaches the screen (CLAUDE.md §4).
   */
  code: string
  status: EnrollmentStatus
  seatStatus: SeatStatus
  createdAt: string
  course: Course
  classGroup: ClassGroup
  plan: Plan
  academicPeriod: AcademicPeriod
  billingMode: BillingMode
  /** Present only when billingMode === 'monthly' (English, CLAUDE.md §1). */
  monthly: MonthlyBilling | null
  /** Empty until course modules have a backend (OOC-94 / OOC-85). */
  modules: CourseModule[]
  /**
   * Every payment written for this enrollment, newest first — the package, or
   * a replacement after a rejected receipt. The newest one speaks for the
   * seat, as on the ledger. Months of a monthly enrollment will live in
   * `monthly.payments` (OOC-86).
   */
  payments: Payment[]
  /**
   * The portal cadeado on the "join class" option (CLAUDE.md §1). Null until
   * monthly billing and module progression exist (OOC-86 / OOC-85) — nothing
   * stored today can lock a class.
   */
  classAccessLock: ClassAccessLock
  /**
   * Final grade once the class group closes. ≥ 14 earns the free certificate;
   * `did_not_attempt` (DA — skipped the final exam) never does
   * (docs/DOCUMENTOS-E-CERTIFICADOS.md). Null while the course runs.
   */
  finalGrade: number | 'did_not_attempt' | null
  /**
   * Progress 0–100 for active/completed enrollments; null while under review,
   * and null for every enrollment until modules and grades are recorded —
   * the calendar alone is not progress.
   */
  progressPct: number | null
}

export interface PortalDocument {
  id: string
  type: DocumentType
  status: DocumentStatus
  enrollmentId: string
  /** Present only when status === 'available'. */
  fileUrl: string | null
  issuedAt: string | null
}

/** One row of the paid-procedures price table (docs/REGRAS-NEGOCIO.md §5). */
export interface ProcedureCatalogItem {
  type: RequestType
  priceCents: number
  currency: 'PEN'
}

export interface StudentRequest {
  id: string
  type: RequestType
  status: RequestStatus
  enrollmentId: string
  /** Procedure price frozen when the request was made (CLAUDE.md §5). */
  priceCents: number
  currency: 'PEN'
  createdAt: string
  payment: Payment
  /** The delivered document, once completed — null before that. */
  resultUrl: string | null
}

export interface PortalNotification {
  id: string
  kind: NotificationKind
  createdAt: string
  /** Real course name to interpolate into the message — student data, not copy. */
  courseName: string | null
}

/**
 * A date-and-schedule choice inside a continuation offer. Start date and
 * schedule are separate choices (CLAUDE.md §1): the same course opens on
 * several dates, each with its own time slots.
 */
export interface OfferGroup {
  id: string
  name: string
  teacherName: string
  schedule: WeeklySlot[]
  startDate: string
  seatsLeft: number
}

/**
 * A next step offered inside the portal (decision 02/09/2026): whoever is
 * already a student never re-enters through the public site — next level,
 * repeat module and re-enrollment all start here, on the existing record.
 */
export interface ContinuationOffer {
  id: string
  kind: 'next_level' | 'repeat_module' | 're_enroll'
  /** Target course — catalog data. */
  courseName: string
  /** The completed course that unlocked this offer. */
  basedOnCourseName: string
  priceCents: number
  currency: 'PEN'
  groups: OfferGroup[]
}

/** Everything the portal needs for one signed-in student. */
export interface PortalSession {
  student: Student
  enrollments: Enrollment[]
  documents: PortalDocument[]
  requests: StudentRequest[]
  procedures: ProcedureCatalogItem[]
  offers: ContinuationOffer[]
  notifications: PortalNotification[]
  nextClass: NextClassOccurrence | null
}

export interface NextClassOccurrence {
  enrollmentId: string
  courseName: string
  classGroupName: string
  teacherName: string
  /** ISO UTC of the next session start. */
  startsAt: string
  classroomUrl: string | null
  /** The same cadeado the enrollment carries, so the hero card can honor it. */
  classAccessLock: ClassAccessLock
}
