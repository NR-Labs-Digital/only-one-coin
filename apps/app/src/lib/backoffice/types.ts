/**
 * Domain shapes for the backoffice UI (mockup phase).
 *
 * Same naming as the future database rows (CLAUDE.md §4 glossary, §5
 * architecture), so swapping the mock source for real API calls should not
 * touch a component. Money is integer cents; timestamps are ISO 8601 UTC and
 * rendered in America/Lima. No human-facing copy lives here — every enum is
 * resolved to text through the `bo` i18n namespace.
 */

import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type {
  DocumentStatus,
  DocumentType,
  EnrollmentStatus,
  NationalIdType,
  PaymentMethod,
  PaymentRail,
  PaymentStatus,
  SeatStatus,
} from '@/lib/portal/types'

/**
 * TODO(content-bug): everything is online (CLAUDE.md §1) — the portal already
 * dropped this field, and the backoffice screens/mock rows still carrying
 * `in_person`/`hybrid` should drop it too. Kept local here until that sweep.
 */
export type ClassModality = 'online' | 'in_person' | 'hybrid'

export type {
  DocumentStatus,
  DocumentType,
  EnrollmentStatus,
  NationalIdType,
  PaymentMethod,
  PaymentRail,
  PaymentStatus,
  SeatStatus,
}

/**
 * Panel cargos (owner's map, 07/09/2026 — see `permissions.ts` for what each
 * one opens). `master` is the platform owners' cargo, restricted to their
 * e-mail domain (`canHoldMaster`).
 */
export type StaffRole =
  | 'master'
  | 'admin'
  | 'analyst'
  | 'enrollment_supervisor'
  | 'academic_supervisor'
  | 'teacher'
  | 'sales'
  | 'support'
  | 'billing'

export interface StaffUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: StaffRole
  /**
   * The teacher record behind the account, when the role is `teacher`. This is
   * what scopes the panel to their own class groups — read from the
   * authenticated user's row on every sensitive request, never from anything
   * the client sends (CLAUDE.md §8).
   */
  teacherId: string | null
}

/**
 * Whether the account still opens the panel. Never a delete: whoever approved a
 * payment or signed a grade stays pointed at by those rows (CLAUDE.md §6), so
 * somebody who leaves loses the door, not the record.
 *
 * `invited` sits before `active`: the row exists — a cargo was decided and an
 * invite link was generated for it — but nobody has signed in yet, because
 * nobody outside the person invited holds the password (CLAUDE.md §8, "a
 * panel that shows somebody else's password is a panel that has it").
 */
export type StaffStatus = 'active' | 'invited' | 'inactive'

/**
 * One row of the team directory — an account that opens the backoffice, and the
 * cargo it opens it with.
 *
 * The `role` is shown here and changed from here, but it is never a field on a
 * form that writes the user: the only way it moves is the dedicated promotion
 * usecase, admin-only and behind fresh re-authentication (CLAUDE.md §8). The
 * screen is where the decision is taken, `apps/api` is where it is allowed.
 */
export interface StaffMemberRow {
  id: string
  firstName: string
  lastName: string
  email: string
  role: StaffRole
  status: StaffStatus
  /**
   * The teacher record behind the account, when the cargo is `teacher` — the
   * same link `StaffUser` carries, and what scopes the panel to their own class
   * groups. An account is given to somebody already on the roster: the person
   * is registered in Docentes first, exactly like a manual enrollment only acts
   * on a student who already exists (CLAUDE.md §1).
   */
  teacherId: string | null
  /**
   * Whether the second factor is on (`twoFactorEnabled`, OOC-29). Required for
   * `master`, `admin` and `billing` (CLAUDE.md §8) — apps/api refuses those
   * cargos everywhere until it is on, so a pending one is an account that has
   * not signed in since. Enrolling it is the account owner's own action, by a
   * code e-mailed to them; nobody enrolls it for them.
   */
  mfaEnrolled: boolean
  /** ISO date the account was opened — the day the invite was completed. */
  joinedAt: string
  /** Last sign-in to the panel; null while the account has never been used. */
  lastAccessAt: string | null
  /**
   * The pending invite's one-time token, while `status` is `invited`. Null the
   * rest of the time: an active or inactive account has nothing left to
   * complete, and this is not a credential to keep lying around.
   */
  inviteToken: string | null
  /** When the invite link stops working. Null outside `invited`. */
  inviteExpiresAt: string | null
}

/**
 * What the invite form fills in. No password: nobody but the person invited
 * ever holds one — the form generates a one-time invite link instead, and the
 * person sets their own password completing it (CLAUDE.md §8, "a panel that
 * shows somebody else's password is a panel that has it").
 */
export type NewStaffMember = Pick<
  StaffMemberRow,
  'firstName' | 'lastName' | 'email' | 'role' | 'teacherId'
>

/**
 * A teacher file a `teacher` invite can be opened for (OOC-79): on the roster,
 * with no panel account and no invite already open. Name and e-mail fill the
 * invite form; the API checks the same rules again when it is sent.
 */
export interface InvitableTeacher {
  id: string
  firstName: string
  lastName: string
  email: string
}

/**
 * One line of the cargo ledger: every change of `role`, and the alta that gave
 * the account its first one. Append-only in the database — no grant of UPDATE
 * or DELETE, not even for admin (CLAUDE.md §8) — so this is read, never edited.
 *
 * `fromRole` is null on the alta: there was no cargo before it.
 */
export interface StaffRoleChange {
  id: string
  at: string
  /** Whose cargo moved. */
  memberId: string
  memberName: string
  fromRole: StaffRole | null
  toRole: StaffRole
  /** Who signed it off — always an admin, by the rule that allows it at all. */
  actorName: string
  actorRole: StaffRole
}

/**
 * Derived by `apps/api` from the student's seats, not a stored column
 * (OOC-116): `active` = a current enrollment (confirmed seat in a class group
 * enrolling or in progress), `former` = confirmed seats, none current,
 * `under_review` = only a reserved seat (pickers only — Payments settles it),
 * `no_enrollment` = nothing confirmed or reserved.
 */
export type StudentStatus = 'active' | 'former' | 'under_review' | 'no_enrollment'

export type GuardianRelationship = 'mother' | 'father' | 'legal_guardian'

export interface GuardianSummary {
  firstName: string
  lastName: string
  relationship: GuardianRelationship
  nationalIdType: NationalIdType
  nationalId: string
  email: string
  phone: string
  /** Ley 29733 consent record — CLAUDE.md §8. Null = consent still missing. */
  consent: { version: string; acceptedAt: string; ip: string } | null
}

/** One row of the student list. */
export interface StudentRow {
  id: string
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  email: string
  phone: string
  birthDate: string
  isMinor: boolean
  status: StudentStatus
  /** ISO 3166-1 alpha-2 country, as declared at enrollment. */
  country: string
  /** First-level division — `departamento` in Peru. Null where we don't map one. */
  region: string | null
  city: string
  activeCourses: number
  totalEnrollments: number
  createdAt: string
  lastActivityAt: string
}

/**
 * One enrollment in the student file — course + money + seat, in one row.
 * Every seat the person ever opened, including one still waiting on money and
 * one handed back after a refused payment (OOC-73): the file is the person's
 * history, unlike the ledger, which lists confirmed seats only.
 */
export interface EnrollmentHistoryItem {
  id: string
  /** Tracking code the student quotes on the phone. */
  code: string
  status: EnrollmentStatus
  seatStatus: SeatStatus
  createdAt: string
  courseName: string
  classGroupName: string
  teacherName: string
  academicPeriodName: string
  planName: string
  /** Frozen price version at enrollment time (CLAUDE.md §5). */
  planPriceId: string
  amountCents: number
  currency: 'PEN'
  /** The payment that speaks for the seat now; null when none was written. */
  paymentId: string | null
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  /**
   * Free text naming the method when it is `other` — what the operator wrote,
   * and the only label that row has. Null on every rail.
   */
  paymentMethodDetail: string | null
  operationNumber: string | null
  /** When the payment was credited — null until it is approved. */
  paidAt: string | null
}

/** Where the e-mail carrying a document currently is (outbox, CLAUDE.md §5). */
export type EmailDeliveryStatus = 'not_sent' | 'queued' | 'sent' | 'failed'

/**
 * The e-mail is a consequence of issuing the document — one outbox row per
 * emission, never a separate "send" button. A resend is an audited exception.
 */
export interface DocumentDelivery {
  status: EmailDeliveryStatus
  lastSentAt: string | null
  attempts: number
}

export interface DocumentItem {
  id: string
  type: DocumentType
  status: DocumentStatus
  enrollmentId: string
  issuedAt: string | null
  /** Printed on the PDF and checked by the public validation page. Set only
   *  once the document actually exists. */
  verificationCode: string | null
  /** Null when the batch issued it — the actor is then the system. */
  issuedByName: string | null
  delivery: DocumentDelivery
}

/**
 * A paid administrative procedure that ends in a document. The constancia de
 * matrícula costs S/25 (`docs/REGRAS-NEGOCIO.md` §5) and is paid outside the
 * platform exactly like an enrollment: the student uploads the receipt and the
 * same OCR ladder validates it. No payment gateway is involved (CLAUDE.md §2).
 */
export interface DocumentRequest {
  id: string
  type: DocumentType
  enrollmentId: string
  requestedAt: string
  /** Fee frozen at request time, integer cents (CLAUDE.md §5). */
  feeCents: number
  currency: 'PEN'
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  operationNumber: string | null
}

/** What an uploaded file is. Never a document the platform issues. */
export type AttachmentKind =
  | 'national_id'
  | 'guardian_consent'
  | 'receipt'
  | 'other'

export type AttachmentSource = 'student' | 'staff'

/**
 * A file attached to the student, uploaded by the student from the portal or by
 * staff here. Deliberately NOT a `DocumentItem`: an uploaded PDF carries no
 * verification code, so it must never reach the public validation page.
 */
export interface StudentAttachment {
  id: string
  kind: AttachmentKind
  /** Real file name as uploaded — student data, shown as is (CLAUDE.md §4). */
  fileName: string
  sizeBytes: number
  uploadedAt: string
  uploadedBy: AttachmentSource
  uploadedByName: string
}

/**
 * Append-only audit trail (CLAUDE.md §8), as the student file reads it
 * (OOC-75). The union is what `GET /students/:id/activity` can answer — one
 * per `audit_log` action the tab shows (`student.registered`,
 * `payment.approved`…), never the stored name itself.
 */
export type AuditAction =
  | 'student_registered'
  | 'student_updated'
  | 'guardian_added'
  | 'guardian_updated'
  | 'enrollment_created'
  | 'payment_approved'
  | 'payment_rejected'
  | 'receipt_viewed'

/** Student and guardian data fields, as shown in the file — used by the audit trail. */
export type StudentField =
  | 'first_name'
  | 'last_name'
  | 'id_type'
  | 'id_number'
  | 'email'
  | 'phone'
  | 'country'
  | 'region'
  | 'city'
  | 'birth_date'
  | 'relationship'

/**
 * Versioned e-mail templates (CLAUDE.md §5, outbox). The union *is* the
 * catalog: every transactional message the platform sends has an entry here,
 * and the template it renders lives in the repository — never drawn only in the
 * provider's panel, so what the e-mail screen previews is what ships.
 */
export type EmailTemplate =
  | 'enrollment_submitted'
  | 'guardian_consent_reminder'
  | 'payment_under_review'
  | 'seat_reservation_expiring'
  | 'payment_approved'
  | 'payment_rejected'
  | 'credentials_issued'
  | 'class_access_ready'
  | 'enrollment_certificate_issued'
  | 'certificate_issued'
  /* Internal — the people who run the courses, not the ones taking them. */
  | 'teacher_credentials_issued'
  | 'teacher_class_group_assigned'
  | 'teacher_contract_expiring'
  | 'teacher_grades_pending'
  | 'staff_certificates_ready'

/**
 * What an audit entry points at. Either real data (a course name, an operation
 * number) or field codes the UI translates — never a value from the log: the
 * log names which fields changed, not what they held (Ley 29733).
 */
export type AuditReference =
  | { kind: 'course'; name: string }
  | { kind: 'operation'; number: string }
  | { kind: 'fields'; fields: StudentField[] }

export interface AuditEntry {
  id: string
  at: string
  action: AuditAction
  /** Null when the account behind the entry no longer exists. */
  actorName: string | null
  actorRole: StaffRole | null
  reference: AuditReference | null
}

/** One page of a student's activity, newest first. */
export interface StudentActivityPage {
  items: AuditEntry[]
  /** Pass back as `?cursor=` for the next page; null on the last one. */
  nextCursor: string | null
}

/** Where a student's portal account stands, as the API derives it. */
export type PortalAccessState = 'none' | 'pending_activation' | 'active'

/** Full student file. */
export interface StudentDetail extends StudentRow {
  portalAccess: PortalAccessState
  guardian: GuardianSummary | null
  enrollments: EnrollmentHistoryItem[]
  documents: DocumentItem[]
  /** Paid procedures still on their way to becoming a document. */
  documentRequests: DocumentRequest[]
  attachments: StudentAttachment[]
}

/* -------------------------------------------------------------------------- */
/* Class groups — where certificates are issued in batch                       */
/* -------------------------------------------------------------------------- */

/**
 * `draft` = opened in the panel but not on sale yet — dates may be missing and
 * the checkout never offers it (OOC-35). `finished` = classes are over but
 * certificates are still owed. `closed` = everyone who qualified already got
 * theirs. A failed student never gets one, so "all certificates issued" can
 * never be the gate — it would leave any class group with a failure open
 * forever.
 */
export type ClassGroupStatus =
  | 'draft'
  | 'enrolling'
  | 'in_progress'
  | 'finished'
  | 'closed'

/**
 * How the certificate is earned (`docs/REGRAS-NEGOCIO.md` §6). Most courses
 * certify on grades alone; Inglés Básico additionally requires a certification
 * exam the student has to request, so it never goes out in a blind batch.
 */
export type CertificateRule = 'automatic' | 'exam_required'

/** Final grade outcome. `auto_failed` is the DA — a missed final exam. */
export type GradeStatus = 'approved' | 'failed' | 'auto_failed' | 'pending'

export type CertificationExamStatus =
  | 'approved'
  | 'failed'
  | 'pending'
  | 'not_requested'

/** Weekday code — the screen resolves it to a short label via the locale. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/**
 * The language a course belongs to. Carried as catalogue data, not as a
 * translated enum: the Asociación runs ~10 languages and opens new ones
 * (quechua workshops included), and `CLAUDE.md` §1 is explicit that nothing
 * language-specific belongs in the code. Same treatment as `courseName`.
 */
export interface CourseLanguage {
  id: string
  name: string
}

export interface ClassGroupRow {
  id: string
  courseName: string
  /**
   * The code the institution prints on paperwork and uses on the phone —
   * catalog data, not a technical id, which is why it is allowed on screen
   * (CLAUDE.md §4). Format still to be confirmed with the Asociación.
   */
  code: string
  language: CourseLanguage
  /** Weekly schedule — the days plus the start time, in America/Lima. */
  weekdays: Weekday[]
  startTime: string
  teacherId: string
  teacherName: string
  modality: ClassModality
  academicPeriodName: string
  startDate: string
  endDate: string
  seatsTaken: number
  capacity: number
  status: ClassGroupStatus
  certificateRule: CertificateRule
  /**
   * Which administrative procedures the catalog offers for this class group
   * (`docs/REGRAS-NEGOCIO.md` §5). Config, not code: freezing is off for
   * Inglés Intermedio/Avanzado and the schedule change only exists for Inglés
   * Básico Regular, and neither rule may be inferred from the course name —
   * nothing language-specific lives in the code (CLAUDE.md §1).
   */
  allowsFreeze: boolean
  allowsTransfer: boolean
  /** Students who finished and are still waiting for their certificate. */
  pendingCertificates: number
  /**
   * Final grades still open on the roster — what the teacher owes this class
   * group. A student moved out by a procedure (frozen, transferred, withdrawn)
   * is not counted: they left the roster, not a grade behind.
   */
  pendingGrades: number
  /**
   * Where the class happens — every class is online, on Google Meet with the
   * material on Classroom (`docs/REGRAS-NEGOCIO.md` §8). External links the
   * coordination pastes when it opens the group, never an integration
   * (CLAUDE.md §2). Null while nobody has pasted it yet.
   */
  meetUrl: string | null
  classroomUrl: string | null
  /**
   * The module this class group is teaching, 1-based — each class group runs
   * one module at a time (`docs/REGRAS-NEGOCIO.md` §3). Null when the course
   * is not split in modules.
   */
  moduleNumber: number | null
  /**
   * The module's material — a Google Drive link coordination sets once per
   * module in the backoffice, and every class group on that module reads.
   */
  moduleMaterialsUrl: string | null
  /**
   * The Classroom link the teacher hands to the students: set by the teacher
   * on their own class group, shown to the enrolled students in their portal.
   * Not the same link as `classroomUrl`, which is what coordination gives
   * the teacher.
   */
  studentClassroomUrl: string | null
}

/** One weekly meeting of a class group, `HH:mm` in America/Lima. */
export interface WeeklySlotItem {
  weekday: Weekday
  startTime: string
  endTime: string
}

/** A class group as the catalog API answers it (OOC-35). */
export interface ClassGroupItem {
  id: string
  code: string
  courseId: string
  courseName: string
  /** Catalog text ("Inglés"), not a code — the screen folds by it. */
  language: string
  courseActive: boolean
  academicPeriodId: string
  academicPeriodName: string
  /** The teacher allocated from the roster (OOC-80); null = nobody yet. */
  teacherId: string | null
  /** The allocated teacher's name, from their file; empty when unallocated. */
  teacherName: string
  /**
   * The free text typed before teachers had a file. Only a hint for whoever
   * links the class group to a real teacher — never shown as the teacher.
   */
  legacyTeacherName: string
  slots: WeeklySlotItem[]
  /** Null only on a draft. */
  startsOn: string | null
  endsOn: string | null
  /** Null = no limit on that side of the enrollment window. */
  enrollmentOpensAt: string | null
  enrollmentClosesAt: string | null
  capacity: number
  seatsTaken: number
  status: ClassGroupStatus
  /** False once retired from the catalog — the row stays, off sale. */
  active: boolean
  waitlistCount: number
}

/**
 * A teacher the class group form can allocate (OOC-80, `GET /catalog/teacher-options`):
 * the roster only, with what the form needs to filter by language and to warn
 * about the schedule — no document, contact or contract.
 */
export interface TeacherOption {
  id: string
  firstName: string
  lastName: string
  /** Catalog text, the same as `ClassGroupItem.language`. */
  languages: string[]
  availability: WeeklySlotItem[]
  /** Their class groups not yet finished, closed or retired. */
  classGroups: { id: string; code: string; academicPeriodId: string; slots: WeeklySlotItem[] }[]
}

/** A sales period: its own class groups, start dates and seats (CLAUDE.md §1). */
export interface AcademicPeriodItem {
  id: string
  name: string
  startsOn: string
  endsOn: string
  active: boolean
  classGroupCount: number
}

/** One student waiting for a seat in a full class group. */
export interface WaitlistItem {
  id: string
  studentId: string
  studentName: string
  nationalIdType: NationalIdType
  nationalId: string
  joinedAt: string
}

/**
 * Who is enrolled in a class group (confirmed seats). `file` — national id and
 * contact — comes only to who reads the student file; the API leaves it out
 * for everyone else, and `view` says which of the two the reader got.
 */
export interface ClassGroupRoster {
  view: 'full' | 'limited'
  items: ClassGroupRosterItem[]
}

export interface ClassGroupRosterItem {
  enrollmentId: string
  studentId: string
  studentName: string
  planName: string
  /** The enrollment's latest payment; null for a seat confirmed without one (seed, legacy import). */
  paymentStatus: PaymentStatus | null
  file: {
    nationalIdType: NationalIdType
    nationalId: string
    email: string
    phone: string
  } | null
}

/**
 * A course as the catalog holds it. The class group is an instance of a course
 * with a schedule, a teacher and seats (`docs/REQUISITOS.md` RF09) — what lives
 * here is what every one of its class groups inherits.
 *
 * Price is deliberately absent: it is versioned and never edited, and the
 * enrollment freezes the `plan_price_id` in force (CLAUDE.md §5). Editing a
 * price from a course screen is how history gets revalidated.
 */
export interface CourseRow {
  id: string
  name: string
  language: CourseLanguage
  /** Catalog label ("A1", "Inicial", "B1") — data, not an enum. */
  level: string
  /**
   * What the course is, in the student's words. No longer asked when the
   * course is opened (OOC-107) — blank on new courses; the portal hides
   * "Sobre el curso" when it is.
   */
  summary: string
  /** Minimum age, per course (`docs/REGRAS-NEGOCIO.md` §2). */
  minAge: number
  modules: number
  totalHours: number
  certificateRule: CertificateRule
  /** Administrative procedures the course offers (`docs/REGRAS-NEGOCIO.md` §5). */
  allowsFreeze: boolean
  allowsTransfer: boolean
  /**
   * The landing page whose enroll button opens the checkout on this course
   * (OOC-117). Null: no landing page links here.
   */
  landingKey: LandingCourseKey | null
  /** Out of the catalog does not delete anything — running class groups stay. */
  active: boolean
  /** Class groups already opened from this course. */
  classGroupCount: number
  /** Plans on it that are not retired. */
  planCount: number
  /**
   * A live plan has a price already in force. Without one the course never
   * reaches /enrollment, however many class groups are enrolling.
   */
  hasPriceInForce: boolean
}

/** The subset of a course that coordination may change. */
export type CourseOptions = Pick<
  CourseRow,
  | 'minAge'
  | 'modules'
  | 'totalHours'
  | 'certificateRule'
  | 'allowsFreeze'
  | 'allowsTransfer'
  | 'active'
>

/**
 * Every `reason` a catalog write can answer, as the locale knows it
 * (`bo.catalog_errors.*`). Anything else falls back to `generic` — a code the
 * screen does not know never reaches the reader (CLAUDE.md §4).
 */
export type CatalogErrorKey =
  | 'generic'
  | 'course_not_found'
  | 'plan_not_found'
  | 'price_in_past'
  | 'period_not_found'
  | 'class_group_not_found'
  | 'invalid_date_range'
  | 'invalid_status_transition'
  | 'class_group_incomplete'
  | 'capacity_below_seats_taken'
  | 'class_group_course_locked'
  | 'period_already_duplicated'
  | 'duplicate_same_period'
  | 'class_group_not_full'
  | 'waitlist_already_joined'
  | 'waitlist_already_enrolled'
  | 'waitlist_student_not_found'
  | 'waitlist_entry_closed'
  | 'waitlist_entry_not_found'
  | 'entry_not_found'
  | 'class_group_teacher_unavailable'
  | 'class_group_teacher_language'
  | 'landing_key_taken'

export interface PlanPriceItem {
  id: string
  amountCents: number
  validFrom: string
  createdAt: string
}

export interface PlanDetail {
  id: string
  name: string
  active: boolean
  currentPriceId: string | null
  prices: PlanPriceItem[]
}

export interface CourseDetail {
  course: CourseRow
  plans: PlanDetail[]
}

/**
 * One dated observation the teacher leaves on a student of their class group —
 * "llegó tarde tres veces", "necesita refuerzo en listening". Free text, per
 * student per class group, teacher-authored. Append-only on screen: an
 * observation is a record, and records are corrected by writing another one.
 */
export interface StudentNote {
  id: string
  /** ISO 8601 UTC, rendered in America/Lima. */
  at: string
  authorName: string
  text: string
}

/** One student as seen from the class group — grade first, money second. */
export interface ClassGroupStudent {
  studentId: string
  fullName: string
  enrollmentId: string
  enrollmentStatus: EnrollmentStatus
  paymentStatus: PaymentStatus
  /**
   * The final exam's grade, 0–20 — what the module's prueba gave, kept apart
   * from the closing grade. Null while not taken (a DA is exactly this exam
   * missed, `docs/REGRAS-NEGOCIO.md` §3) — and the rezagados exam later
   * replaces the final grade, not this record of the first sitting.
   */
  examGrade: number | null
  /** 0–20, the Peruvian scale. Null while the teacher has not closed it. */
  finalGrade: number | null
  gradeStatus: GradeStatus
  /** The teacher's observations on this student, newest first. */
  notes: StudentNote[]
  /** Null unless the course certifies through an exam. */
  certificationExam: CertificationExamStatus | null
  certificateIssuedAt: string | null
  delivery: DocumentDelivery | null
  /** Administrative procedure already applied, if any. */
  procedure: EnrollmentProcedure | null
}

/**
 * What an administrative procedure did to an enrollment
 * (`docs/REGRAS-NEGOCIO.md` §5). Every one of them is paid and coordinated
 * outside the platform today, which is why the backoffice records the outcome
 * instead of triggering it.
 */
export type EnrollmentProcedure = 'frozen' | 'transferred' | 'withdrawn'

export type ProcedureAction = 'transfer' | 'freeze' | 'withdraw'

/** Why a procedure is not on the table — a code the locale turns into text. */
export type ProcedureBlockReason =
  | 'already_applied'
  | 'group_not_running'
  | 'enrollment_not_active'
  | 'payment_not_approved'
  | 'not_offered'
  | 'no_seats_elsewhere'

export interface ClassGroupDetail extends ClassGroupRow {
  students: ClassGroupStudent[]
  /** The teacher's notices to the class group, newest first. */
  notices: ClassGroupNotice[]
}

/**
 * A notice the teacher posts to the whole class group. It reaches every
 * enrolled student in their portal — the course page and the bell. Free text,
 * the teacher's own words; append-only like an observation: a notice that went
 * out to thirty students is corrected by posting another one.
 */
export interface ClassGroupNotice {
  id: string
  text: string
  /** ISO 8601 UTC, rendered in America/Lima. */
  postedAt: string
  authorName: string
}

/** Why a student is out of the batch — a code the locale turns into text. */
export type CertificateBlockReason =
  | 'grade_pending'
  | 'grade_below_minimum'
  | 'auto_failed'
  | 'payment_not_approved'
  | 'enrollment_not_completed'
  | 'exam_not_approved'
  | 'already_issued'

/* -------------------------------------------------------------------------- */
/* Teachers — who runs the class groups                                        */
/* -------------------------------------------------------------------------- */

/**
 * Out of the roster does not delete anything: a teacher who stopped teaching
 * still signed the grades of every class group they ran, and those class groups
 * keep pointing at them. Same treatment as `CourseRow.active`.
 */
export type TeacherStatus = 'active' | 'inactive'

/**
 * One window a teacher is free to take a class group in, on a weekday, in
 * America/Lima. `HH:mm`, end exclusive — the same shape as
 * `ClassGroupRow.startTime`, so a class group can be laid over the window it
 * was allocated into (`docs/REQUISITOS.md` RF03).
 */
export interface AvailabilitySlot {
  weekday: Weekday
  startTime: string
  endTime: string
}

/**
 * A teacher's contract: the window it covers, which is what the panel
 * watches — a teacher running a class group on an expired contract is the
 * institution's problem, not the teacher's.
 *
 * Recorded when the contract is generated from the published template
 * (OOC-124), with the version it was printed from so it prints again; the
 * signed copy is kept outside the platform. Contracts filed before that
 * (OOC-81) carry the uploaded PDF instead, behind a signed URL like a receipt
 * (CLAUDE.md §8).
 */
export interface TeacherContract {
  /** The record — what a download asks for. */
  id: string
  /** When it was generated or filed. */
  recordedAt: string
  /** The window it covers — ISO date, rendered in America/Lima. */
  startsAt: string
  endsAt: string
  /** The PDF filed before OOC-124; null for a generated contract. */
  file: { name: string; sizeBytes: number } | null
  /** The template version a generated contract prints from; null for a filed one. */
  templateVersion: number | null
}

/** One row of the teacher directory. */
export interface TeacherRow {
  id: string
  firstName: string
  lastName: string
  /**
   * The document, same shape as a student's. A teacher signs a contract, and a
   * contract is signed by somebody the institution can name on paper.
   */
  nationalIdType: NationalIdType
  nationalId: string
  email: string
  phone: string
  status: TeacherStatus
  /**
   * Languages the teacher is cleared to run a class group in — catalogue rows,
   * never a translated enum: the Asociación runs ~10 languages and opens new
   * ones, and nothing language-specific belongs in the code (CLAUDE.md §1).
   */
  languages: CourseLanguage[]
  /**
   * ISO 3166-1 alpha-2, resolved to a country name by the reader's locale.
   * Carried because origin is a selling point in the catalog — the Italian
   * class group is advertised with a "docente ítalo-peruano"
   * (`docs/REGRAS-NEGOCIO.md` §3, `docs/REQUISITOS.md` RF03) — not only
   * because it is personal data.
   */
  nationality: string
  /**
   * Where they live — not the same question as `nationality`, which is where
   * they are from. The contract needs an address; the catalog needs an origin.
   */
  country: string
  /** First-level division — `departamento` in Peru. Null outside it. */
  region: string | null
  city: string
  /** Street line: what is missing from country/region/city to post a letter. */
  addressLine: string
  /** Null while nobody has filed one — which is itself worth flagging. */
  contract: TeacherContract | null
  /**
   * Whole days to `contract.endsAt`, negative once the date has passed, null
   * with no contract on file. Computed on the server clock and handed down like
   * the reservation countdown: computing it inside the component would hydrate
   * a different number than it rendered.
   */
  contractDaysLeft: number | null
  /** Class groups still enrolling or running. */
  activeClassGroups: number
  /** Seats taken across those class groups — the teaching load, in people. */
  studentCount: number
  /** `YYYY-MM-DD` — the day the file was registered. */
  joinedAt: string
}

/**
 * Full teacher file, as `GET /api/v1/teachers/:id` answers it (OOC-78). The
 * class groups are the ones allocated through `teacher_id`; the availability
 * is what the next allocation is drawn from — the two are read together, which
 * is why the file carries both.
 */
export interface TeacherDetail extends TeacherRow {
  availability: AvailabilitySlot[]
  classGroups: ClassGroupItem[]
  /**
   * Every contract ever recorded, newest first — the first is `contract`. Recording
   * again adds a row, never replaces one (OOC-81, OOC-124).
   */
  contracts: TeacherContract[]
  /** The backoffice's contract alert window (OOC-41), for the badge. */
  contractAlertDays: number
}

/* -------------------------------------------------------------------------- */
/* Payments — the ledger, the human decision and the validation parameters     */
/* -------------------------------------------------------------------------- */

/**
 * One line of the payment ledger, as `GET /api/v1/payments` serves it. Every
 * payment today belongs to an enrollment, so the course is what it was for.
 */
export interface PaymentRow {
  id: string
  enrollmentId: string
  studentId: string
  studentName: string
  courseName: string
  status: PaymentStatus
  method: PaymentMethod
  /** The free text that names an `other` method — that text is its label. */
  methodDetail: string | null
  operationNumber: string | null
  /** What the receipt says — equals the expected value once approved. */
  amountCents: number
  /** The frozen plan price it is checked against. */
  expectedAmountCents: number
  currency: 'PEN'
  submittedAt: string
  /** When the latest approval or rejection was recorded. Null while open. */
  decidedAt: string | null
  /** Who recorded that decision; null when the audit entry names no account. */
  decidedByName: string | null
}

/**
 * Headline numbers of the payments section. Scoped to the academic period, not
 * to "today": the period is what the treasury closes against, and a daily
 * figure on a screen nobody opens on a Sunday reads as zero collection.
 */
export interface PaymentMetrics {
  /** Empty when no period has started yet — then every count is zero. */
  periodName: string
  inReview: number
  /** Age of the oldest open payment; null when nothing is open. */
  oldestOpenHours: number | null
  approved: number
  collectedCents: number
  rejected: number
}

/** Where a payment's latest receipt upload stands, as the review queue reads it. */
export type ReviewReceiptState = 'missing' | 'uploading' | 'ready' | 'refused'

/** What the antifraud screening found on a receipt — only the kind of it. */
export type ReceiptFraudSignalKind =
  | 'identical_file'
  | 'similar_image'
  | 'edited_with_software'
  | 'modified_after_capture'
  | 'payer_name_mismatch'

/** One field the OCR read, with the model's own confidence (0–1). */
export interface ReadField<T> {
  value: T | null
  confidence: number
}

/** Why the OCR produced no reading — after its retries ran out. */
export type ReadingFailureReason = 'provider_unavailable' | 'invalid_response' | 'unexpected_error'

/**
 * What OCR level 1 read off the receipt (OOC-20). Shown to the reviewer next to
 * the receipt; the judgement on it is `ReviewVerdict` (OOC-21).
 */
export type ReceiptReading =
  | { state: 'not_read' }
  | { state: 'failed'; reason: ReadingFailureReason; modelName: string | null; readAt: string }
  | {
      state: 'read'
      /** Technical model id — for audit, never rendered (CLAUDE.md §4). */
      modelName: string | null
      modelVersion: string | null
      readAt: string
      amountCents: ReadField<number>
      operationNumber: ReadField<string>
      paymentMethod: ReadField<PaymentMethod> & { detail: string | null }
      payerName: ReadField<string>
      /** An instant in UTC, or a bare `YYYY-MM-DD` when the receipt printed no time. */
      paidAt: ReadField<string>
    }

/** The receipt traffic light's verdict (OOC-21). */
export type ReceiptVerdict = 'approve' | 'review' | 'reject_suggested'

export type ReceiptVerdictReason =
  | 'exact'
  | 'within_tolerance'
  | 'overpaid'
  | 'underpaid'
  | 'far_below'
  | 'amount_unread'
  | 'operation_number_unread'
  | 'operation_number_mismatch'
  | 'payment_method_unread'
  | 'payment_method_mismatch'

export interface ReviewVerdict {
  verdict: ReceiptVerdict
  reason: ReceiptVerdictReason
}

/** One payment still owed a decision, as `GET /api/v1/payments/review` serves it. */
export interface PaymentReviewItem {
  id: string
  enrollmentId: string
  studentId: string
  studentName: string
  courseName: string
  classGroupName: string
  planName: string
  status: 'pending' | 'under_review'
  method: PaymentMethod
  methodDetail: string | null
  operationNumber: string | null
  expectedAmountCents: number
  currency: 'PEN'
  receipt: ReviewReceiptState
  fraudSignals: ReceiptFraudSignalKind[]
  /** What the OCR read off the latest receipt; `null` while there is no
   * processed receipt to read. */
  reading: ReceiptReading | null
  /** Whether `reading` and `verdict` are the first reading's or the latest
   * re-read's (Sessão 32). */
  readingSource: 'first' | 'reread'
  /** When a re-read still on its way was asked for; `null` when none is. */
  rereadRequestedAt: string | null
  /** Lowest confidence (0–1) among amount, operation number and method — 0
   * for a failed reading, `null` with no reading. What the queue sorts on. */
  confidence: number | null
  /** The traffic light's verdict on the latest receipt (or its latest
   * re-read); `null` while it has not run. */
  verdict: ReviewVerdict | null
  submittedAt: string
  /** When the open payment overstays the review window. */
  reviewDeadline: string
}

export interface PaymentReviewQueue {
  items: PaymentReviewItem[]
  /** Open payments matching the query, across every page. */
  total: number
  page: number
  pageSize: number
}

/** Why a human turned a receipt down — recorded with the rejection. */
export type RejectionReason =
  | 'amount_mismatch'
  | 'illegible'
  | 'duplicate'
  | 'not_a_receipt'
  | 'other'

/** The human decision over a receipt. Approving carries no reason: the tier
 *  ladder already said why it was here, and the audit entry records who. */
export type ReviewDecision =
  | { kind: 'approve' }
  | { kind: 'reject'; reason: RejectionReason; note: string }


/* -------------------------------------------------------------------------- */
/* Enrollments — who holds a seat, across every class group                    */
/* -------------------------------------------------------------------------- */

/**
 * One line of the enrollment ledger. Deliberately not the same shape as
 * `EnrollmentHistoryItem`: that one is read from inside a student's file, where
 * the person is already known, and this one is read across the institution,
 * where the person is the first thing the row has to say.
 */
export interface EnrollmentRow {
  id: string
  /**
   * The tracking code printed on the checkout's confirmation screen — what the
   * student quotes on the phone. Not `id`: an internal row id is not something
   * anybody should be reading out loud, and a code that only exists on the
   * student's side is a code nobody here can look up (`CLAUDE.md` §4).
   */
  code: string
  studentId: string
  studentName: string
  courseName: string
  /** Null when no class group roster claims this enrollment (mock gap only). */
  classGroupId: string | null
  classGroupName: string
  teacherName: string
  /** Null for a course no longer in the catalog — history keeps its own name. */
  language: CourseLanguage | null
  modality: ClassModality
  academicPeriodName: string
  /** Which tab the row belongs to — shown as a column on the "all" tab. */
  classGroupStatus: ClassGroupStatus
  status: EnrollmentStatus
  seatStatus: SeatStatus
  planName: string
  /** Frozen price version at enrollment time (CLAUDE.md §5). */
  planPriceId: string
  amountCents: number
  currency: 'PEN'
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  /**
   * Free text naming the method when it is `other` — what the operator wrote,
   * and the only label that row has. Null on every rail.
   */
  paymentMethodDetail: string | null
  operationNumber: string | null
  createdAt: string
  paidAt: string | null
  progressPct: number | null
}

/**
 * Headline numbers of the section, scoped to the academic period for the same
 * reason the payment ones are (`PaymentMetrics`): the ciclo is what the
 * institution closes against, and a daily count reads as zero on a Sunday.
 */
export interface EnrollmentMetrics {
  periodName: string
  total: number
  active: number
}

/** A plan as the enrollment form reads it: the price in force, never editable. */
export interface PlanPrice {
  courseName: string
  planName: string
  /** Which plan this is — the API resolves the current price server-side
   * from this id, never from a client-supplied planPriceId (CLAUDE.md §5, §8). */
  planId: string
  planPriceId: string
  amountCents: number
  currency: 'PEN'
}

/** What the backoffice form needs to open an enrollment over an existing student. */
export interface NewEnrollmentInput {
  studentId: string
  classGroupId: string
  method: PaymentMethod
  /** Only when `method` is `other`: what the operator wrote it was. */
  methodDetail: string | null
  operationNumber: string
  /** Whether the staff member attached the receipt image while filling this in. */
  receiptAttached: boolean
}

/* -------------------------------------------------------------------------- */
/* E-mail                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The domain events the automatic e-mails hang off — the spine of the flow.
 * Not a database column: it is what *happens*, in order, and the e-mails are
 * what leaves because of it. Written as events rather than as chapters, because
 * a flow drawn over chapter titles is a list with a line down the side.
 */
export type EmailStage =
  | 'submitted'
  | 'payment_pending'
  | 'payment_settled'
  | 'access'
  | 'documents'

/**
 * Who the template is written to — it decides the tone, the address, and
 * whether the message belongs to the student's journey at all. `teacher` and
 * `staff` are internal: nobody outside the institution ever receives them.
 */
export type EmailAudience = 'student' | 'guardian' | 'teacher' | 'staff'

/**
 * What the provider reported back over a rolling window. Delivery, bounce and
 * failure only: opens would mean a tracking pixel on every message, and that is
 * a consent question (Ley 29733), not a metric to add on the way past.
 */
export interface EmailFlowMetrics {
  sent: number
  delivered: number
  /** Address rejected by the receiving server — it syncs back to the student. */
  bounced: number
  /** Never left the outbox: the provider errored and the retries ran out. */
  failed: number
}

/**
 * The values the preview renders with. Invented on purpose: the preview exists
 * so somebody can check the wording, and rendering it over a real student would
 * put their name and their course on a screen that has no reason to hold either
 * (CLAUDE.md §8).
 */
export interface EmailSample {
  studentName: string
  /** Where the preview says it is going — invented, like the name above it. */
  studentEmail: string
  guardianName: string
  guardianEmail: string
  teacherName: string
  teacherEmail: string
  staffName: string
  staffEmail: string
  courseName: string
  classGroupName: string
  /** Integer cents, formatted at render time (CLAUDE.md §5). */
  amountCents: number
  /** ISO 8601 UTC, rendered in America/Lima. */
  date: string
}

/**
 * One automatic e-mail, as the catalog lists it. Nothing here is a send button:
 * a transactional message is the consequence of something that happened in the
 * domain — a payment approved, a document issued — and the outbox carries it
 * (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4). The screen only says whether the
 * platform is allowed to send it, and what it looks like when it does.
 */
export interface EmailFlow {
  template: EmailTemplate
  audience: EmailAudience
  /**
   * The event it leaves because of — the flow branches off this. Null for the
   * internal ones: a message to a teacher is not a step of the student's
   * journey, and putting it on that line would be drawing a path nobody walks.
   */
  stage: EmailStage | null
  /**
   * Fires only when the case takes that turn: the receipt that needed a human,
   * the seat nobody paid for, the student who is a minor. The journey has to
   * say so, or a branch reads like a step everybody goes through.
   */
  conditional: boolean
  /** Whether the outbox may send it at all. Off means nobody receives it. */
  enabled: boolean
  /** Version of the template in the repository — bumped, never edited in place. */
  version: number
  /** When that version landed. */
  updatedAt: string
  /** Rolling window, `EmailMetrics.windowDays` long. */
  metrics: EmailFlowMetrics
  sample: EmailSample
}

/** The section header — the same window, summed over every flow. */
export interface EmailMetrics {
  windowDays: number
  sent: number
  delivered: number
  bounced: number
  failed: number
  /** Flows currently switched off — nobody is receiving those. */
  paused: number
}

/**
 * Who a manual send goes to. A segment is *computed* — the platform asks the
 * database who matches, at the moment of sending, and never keeps a list at the
 * provider (`docs/ROADMAP.md` fase 5). So this is the question, not the answer:
 * the recipients are whatever it resolves to when somebody presses send.
 */
export type EmailSegment =
  | { kind: 'all' }
  | { kind: 'course'; courseName: string }
  | { kind: 'class_group'; classGroupId: string; classGroupName: string }
  | { kind: 'enrollment_status'; status: EnrollmentStatus }

/** What a manual send is, while it is still being written. */
export interface EmailDraft {
  segment: EmailSegment
  subject: string
  body: string
}

/** Why one delivery did not land. */
export type EmailDeliveryReason =
  /** The classic: a Gmail with no space left (`docs/REGRAS-NEGOCIO.md` §7). */
  | 'mailbox_full'
  | 'address_unknown'
  | 'domain_invalid'
  | 'blocked_by_server'
  /** Never left the outbox: the provider errored and the retries ran out. */
  | 'provider_error'

/** Refused by the receiving server, or given up on by the outbox. */
export type EmailDeliveryState = 'bounced' | 'failed'

/**
 * One e-mail that did not reach one person. It is a person, not a statistic:
 * the student is on the other end waiting for credentials that never arrived,
 * so the row carries who they are and opens their file — which is where the
 * phone number to call them on lives.
 */
export interface EmailDeliveryIssue {
  id: string
  template: EmailTemplate
  studentId: string
  studentName: string
  /** The address that failed — the one on the student's file. */
  address: string
  state: EmailDeliveryState
  reason: EmailDeliveryReason
  /** Last attempt, ISO 8601 UTC. */
  at: string
  attempts: number
}

/* -------------------------------------------------------------------------- */
/* Settings — the numbers and names the platform runs on                       */
/* -------------------------------------------------------------------------- */


/**
 * The account a staff member manages for themselves — access, not identity.
 * Name, login e-mail and role are not here as editable values on purpose: the
 * role is written only by the dedicated promotion usecase (CLAUDE.md §8), and
 * the rest is administration's to change.
 */

/** The only second factor the panel offers — a code e-mailed at sign-in (OOC-29). */
export type MfaMethod = 'email'

export interface AccountMfa {
  enabled: boolean
  method: MfaMethod
  /** When the current device was enrolled. Null while the factor is off. */
  enrolledAt: string | null
  /** Unused recovery codes left — what is between a lost phone and a lockout. */
  recoveryCodesLeft: number
}

export interface AccountSecurity {
  /** Null when the password is still the one the account was created with. */
  passwordUpdatedAt: string | null
  mfa: AccountMfa
  lastSignInAt: string
}

/**
 * One open session. Browser and system are proper names, so they stay as they
 * are (CLAUDE.md §4 exception for brand names); the country is a code and gets
 * resolved to a name on screen.
 */
export interface AccountSession {
  id: string
  browser: string
  os: string
  ip: string
  city: string
  /** ISO 3166-1 alpha-2. */
  country: string
  lastActiveAt: string
  /** The session reading this screen — the one that cannot close itself. */
  current: boolean
}

export interface AccountOverview {
  user: StaffUser
  security: AccountSecurity
  sessions: AccountSession[]
}
