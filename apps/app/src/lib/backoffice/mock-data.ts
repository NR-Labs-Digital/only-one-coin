import type {
  AccountOverview,
  AuditEntry,
  AvailabilitySlot,
  ClassGroupDetail,
  ClassGroupRow,
  ClassGroupStudent,
  CourseLanguage,
  CourseRow,
  DashboardMetrics,
  EnrollmentMetrics,
  EnrollmentRow,
  DocumentDelivery,
  DocumentItem,
  EmailDeliveryIssue,
  EmailFlow,
  EmailMetrics,
  EmailSegment,
  EnrollmentHistoryItem,
  ExtractionField,
  PaymentMethod,
  PaymentMetrics,
  PaymentRow,
  PaymentSettings,
  PlanPrice,
  ReceiptExtraction,
  ReviewFlag,
  ReviewQueueItem,
  SeatReservation,
  SeatWatchItem,
  StaffUser,
  StudentDetail,
  StudentRow,
  TeacherContract,
  TeacherDetail,
  TeacherRow,
} from './types'
import { daysUntil } from './contract'

/**
 * Mock backoffice dataset for the UI/UX phase. Every value is shaped like the
 * database row it will replace (CLAUDE.md §5); swapping this module for real
 * API calls should not require touching a component.
 *
 * Prices are the honest per-course prices (e.g. Inglés S/69.90) — never a
 * discount, never the S/1 landing hook. Dates are UTC, rendered in
 * America/Lima. Names are fictional.
 */

/**
 * The signed-in staff member's own account — access, never identity. Shaped
 * like the rows behind it: the protected `user` row (CLAUDE.md §8), the
 * password/second-factor state beside it, and the open sessions the auth
 * library keeps. Swapping this for real queries should not touch a component.
 *
 * The sessions are deliberately more than one, and one of them is a phone in a
 * different city: the screen only earns its place if there is something to
 * recognise — or not recognise — on it.
 */

const PERIOD = ''

function enrollment(
  partial: Partial<EnrollmentHistoryItem> & Pick<EnrollmentHistoryItem, 'id'>,
): EnrollmentHistoryItem {
  return {
    status: 'active',
    seatStatus: 'confirmed',
    createdAt: '2026-07-02T14:20:00Z',
    courseName: 'Inglés Básico A1',
    classGroupName: 'A1 — Lun/Mié 18:00',
    teacherName: 'Carlos Meza',
    modality: 'online',
    academicPeriodName: PERIOD,
    planName: 'Paquete completo',
    planPriceId: 'pp_en_a1_v3',
    amountCents: 6990,
    currency: 'PEN',
    paymentStatus: 'approved',
    paymentMethod: 'yape',
    paymentMethodDetail: null,
    operationNumber: '00871245',
    paidAt: '2026-07-02T14:12:00Z',
    progressPct: 45,
    ...partial,
  }
}

function audit(
  partial: Partial<AuditEntry> & Pick<AuditEntry, 'id' | 'action' | 'at'>,
): AuditEntry {
  return {
    actorName: 'Lucía Ramírez',
    actorRole: 'admin',
    reference: null,
    ...partial,
  }
}

/**
 * Fee for the constancia de matrícula (`docs/REGRAS-NEGOCIO.md` §5: S/25).
 * A backoffice setting in the real system, never a constant in the code — the
 * same rule the payment tolerance follows (CLAUDE.md §5).
 */
export const CONSTANCIA_FEE_CENTS = 2500

/**
 * Minimum passing grade, 0–20 scale (`docs/REGRAS-NEGOCIO.md` §3: 14). Also a
 * backoffice setting later; it lives here so the batch preview has one source.
 */
export const PASSING_GRADE = 14

function noEmail(): DocumentDelivery {
  return { status: 'not_sent', lastSentAt: null, attempts: 0 }
}

function doc(
  partial: Partial<DocumentItem> &
    Pick<DocumentItem, 'id' | 'type' | 'enrollmentId'>,
): DocumentItem {
  return {
    status: 'available',
    issuedAt: null,
    verificationCode: null,
    issuedByName: null,
    delivery: noEmail(),
    ...partial,
  }
}

/**
 * The tail of the human review queue. One entry describes a person, the seat
 * they reserved and the receipt still waiting on a human — the student file
 * and the queue row are both derived from it, so the two screens can never
 * disagree about the same receipt.
 */
interface PendingReceipt {
  id: string
  studentId: string
  firstName: string
  lastName: string
  nationalId: string
  email: string
  phone: string
  region: string
  city: string
  birthDate: string
  courseName: string
  classGroupName: string
  teacherName: string
  method: PaymentMethod
  /** What the extraction read on the receipt. */
  amountCents: number
  /** The frozen plan price it is checked against (CLAUDE.md §5). */
  expectedAmountCents: number
  operationNumber: string | null
  flag: ReviewFlag
  tier: number
  confidence: number
  submittedAt: string
}

/** Price version each course was selling under this period. */
const PLAN_PRICE_ID: Record<string, string> = {
  'Inglés Básico A1': 'pp_en_a1_v3',
  'Inglés Intermedio B1': 'pp_en_b1_v2',
  'Francés Inicial': 'pp_fr_i_v2',
  'Alemán Inicial': 'pp_de_i_v1',
  'Italiano Inicial': 'pp_it_i_v1',
  'Portugués Inicial': 'pp_pt_i_v2',
  'Quechua Conversacional': 'pp_qu_i_v1',
}

const pendingReceipts: PendingReceipt[] = []

/**
 * A student the panel only knows because a receipt of theirs is waiting: seat
 * reserved, payment under review, nothing issued yet.
 */
function pendingStudent(receipt: PendingReceipt): StudentDetail {
  return {
    id: receipt.studentId,
    firstName: receipt.firstName,
    lastName: receipt.lastName,
    nationalIdType: 'DNI',
    nationalId: receipt.nationalId,
    email: receipt.email,
    phone: receipt.phone,
    birthDate: receipt.birthDate,
    isMinor: false,
    status: 'under_review',
    country: 'PE',
    region: receipt.region,
    city: receipt.city,
    activeCourses: 0,
    totalEnrollments: 1,
    createdAt: receipt.submittedAt,
    lastActivityAt: receipt.submittedAt,
    guardian: null,
    enrollments: [
      enrollment({
        id: receipt.id.replace('rev_', 'enr_19'),
        status: 'under_review',
        seatStatus: 'reserved',
        paymentStatus: 'under_review',
        courseName: receipt.courseName,
        classGroupName: receipt.classGroupName,
        teacherName: receipt.teacherName,
        planPriceId: PLAN_PRICE_ID[receipt.courseName] ?? 'pp_en_a1_v3',
        // The enrollment carries the frozen plan price; what the receipt reads
        // is the extraction's problem, not the enrollment's (CLAUDE.md §5).
        amountCents: receipt.expectedAmountCents,
        paymentMethod: receipt.method,
        paymentMethodDetail: null,
        operationNumber: receipt.operationNumber,
        createdAt: receipt.submittedAt,
        paidAt: null,
        progressPct: null,
      }),
    ],
    documents: [],
    documentRequests: [],
    attachments: [],
    activity: [
      audit({
        id: `aud_${receipt.id}_flagged`,
        action: 'payment_flagged',
        at: receipt.submittedAt,
        actorName: 'Sistema',
        actorRole: 'billing',
        reference: { kind: 'review_flag', flag: receipt.flag },
      }),
      audit({
        id: `aud_${receipt.id}_created`,
        action: 'enrollment_created',
        at: receipt.submittedAt,
        actorName: 'Sistema',
        actorRole: 'enrollment_supervisor',
        reference: { kind: 'course', name: receipt.courseName },
      }),
    ],
  }
}

const students: StudentDetail[] = []


export function getDashboardMetrics(): DashboardMetrics {
  return {
    enrollmentsToday: 0,
    enrollmentsTodayDelta: 0,
    pendingReview: listReviewQueue().length,
    oldestPendingHours: 0,
    activeStudents: 0,
    activeStudentsDelta: 0,
    seatsTaken: 0,
    seatsCapacity: 0,
  }
}

/** Receipts already sitting on a student file of their own. */
const flaggedReceipts: ReviewQueueItem[] = []

/**
 * The whole human queue, oldest first — the order it is worked in, and the one
 * the screen promises. Never a model's decision: tier 3 and divergence end
 * here by rule (CLAUDE.md §5).
 */
export function listReviewQueue(): ReviewQueueItem[] {
  return [
    ...flaggedReceipts,
    ...pendingReceipts.map(
      ({
        studentId,
        firstName,
        lastName,
        courseName,
        method,
        amountCents,
        expectedAmountCents,
        operationNumber,
        flag,
        tier,
        confidence,
        submittedAt,
        id,
      }): ReviewQueueItem => ({
        id,
        studentId,
        studentName: `${firstName} ${lastName}`,
        courseName,
        method,
        amountCents,
        expectedAmountCents,
        operationNumber,
        flag,
        tier,
        confidence,
        submittedAt,
      }),
    ),
  ].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
}

/** Home preview: the five that have been waiting the longest. */
export function getReviewQueue(): ReviewQueueItem[] {
  return listReviewQueue().slice(0, 5)
}

export function getSeatWatch(): SeatWatchItem[] {
  return []
}

/* -------------------------------------------------------------------------- */
/* Class groups                                                                */
/* -------------------------------------------------------------------------- */

/** Language catalogue. New languages are rows here, never code branches. */
const LANGUAGES = {
  en: { id: 'lang_en', name: 'Inglés' },
  it: { id: 'lang_it', name: 'Italiano' },
  fr: { id: 'lang_fr', name: 'Francés' },
  de: { id: 'lang_de', name: 'Alemán' },
  qu: { id: 'lang_qu', name: 'Quechua' },
  pt: { id: 'lang_pt', name: 'Portugués' },
} as const

/**
 * Class groups across the three states that matter for the panel: still
 * enrolling, running, and finished — the last one being where certificates get
 * issued in batch. `certificateRule: 'exam_required'` marks Inglés Básico,
 * which certifies only after the student sits the certification exam
 * (`docs/REGRAS-NEGOCIO.md` §6), so it never goes out in a blind batch.
 */
/**
 * The seed rows carry everything but `pendingGrades`, which is derived from the
 * roster by `pendingGradesOf` — a stored copy of a count the students already
 * answer would be a number that drifts.
 */
/**
 * Student seeds may leave the newer per-student fields out — `examGrade` and
 * `notes` default when served, so forty existing roster literals did not have
 * to grow two lines each.
 */
type ClassGroupStudentSeed = Omit<ClassGroupStudent, 'examGrade' | 'notes'> &
  Partial<Pick<ClassGroupStudent, 'examGrade' | 'notes'>>

type ClassGroupSeed = Omit<ClassGroupDetail, 'pendingGrades' | 'students'> & {
  students: ClassGroupStudentSeed[]
}

function serveStudents(students: ClassGroupStudentSeed[]): ClassGroupStudent[] {
  return students.map((student) => ({
    ...student,
    examGrade: student.examGrade ?? null,
    notes: student.notes ?? [],
  }))
}

const classGroups: ClassGroupSeed[] = []

/**
 * The course catalog. Hours and module counts come from
 * `docs/REGRAS-NEGOCIO.md` §3 where the source states them (Inglés Básico: 4
 * modules, 20h each) and are plausible fill-ins elsewhere — the real numbers
 * are catalog data the Asociación owns, not something to derive in code.
 *
 * `minAge` follows §2: 13 for every language except the Inglés kids track,
 * which does not exist in this mock.
 */
const courses: CourseRow[] = []

/** Class group count is derived, never stored — it would drift the moment one opens. */
export function listCourses(): CourseRow[] {
  return courses
    .map((course) => ({
      ...course,
      classGroupCount: classGroups.filter((group) => group.courseName === course.name)
        .length,
    }))
    .sort(
      (a, b) =>
        a.language.name.localeCompare(b.language.name) || a.name.localeCompare(b.name),
    )
}

/**
 * Final grades still open on a roster — what the teacher owes the class group.
 * Only while there is something to owe: an enrolling group has not taught
 * anything yet and a closed one is history, so both count zero. A student
 * moved out by a procedure (frozen, transferred, withdrawn) is not counted
 * either: they left the roster, not a grade behind.
 */
function pendingGradesOf(group: ClassGroupSeed): number {
  if (group.status !== 'in_progress' && group.status !== 'finished') return 0
  return group.students.filter(
    (student) => student.gradeStatus === 'pending' && student.procedure === null,
  ).length
}

export function listClassGroups(): ClassGroupRow[] {
  return classGroups.map((group) => {
    const { students, ...row } = group
    void students
    return { ...row, pendingGrades: pendingGradesOf(group) }
  })
}

export function getClassGroup(id: string): ClassGroupDetail | undefined {
  const group = classGroups.find((item) => item.id === id)
  if (!group) return undefined
  return {
    ...group,
    students: serveStudents(group.students),
    pendingGrades: pendingGradesOf(group),
  }
}

/**
 * The class groups with their rosters attached — what `listClassGroups()`
 * deliberately strips. Read by anything that has to count across every roster
 * at once (grades, administrative procedures), never by a list screen: a
 * directory has no business carrying every student of every class group.
 */
export function listClassGroupRosters(): ClassGroupDetail[] {
  return classGroups.map((group) => ({
    ...group,
    students: serveStudents(group.students),
    pendingGrades: pendingGradesOf(group),
  }))
}

/* -------------------------------------------------------------------------- */
/* Teachers                                                                    */
/* -------------------------------------------------------------------------- */

/** Weekly availability, written the way the schedule is spoken about. */
function slots(
  weekdays: AvailabilitySlot['weekday'][],
  startTime: string,
  endTime: string,
): AvailabilitySlot[] {
  return weekdays.map((weekday) => ({ weekday, startTime, endTime }))
}

/**
 * Teacher roster. Everything countable — class groups, students, pending
 * grades, pending certificates — is derived from `classGroups` below rather
 * than written here, so the roster can never disagree with the class group
 * list about who teaches what.
 *
 * The nationalities are not decoration: the catalog advertises the Italian
 * class group with a "docente ítalo-peruano" (`docs/REGRAS-NEGOCIO.md` §3), so
 * origin is catalogue data the ficha carries (`docs/REQUISITOS.md` RF03).
 */
const teachers: Omit<
  TeacherDetail,
  | 'activeClassGroups'
  | 'studentCount'
  | 'pendingGrades'
  | 'pendingCertificates'
  | 'classGroups'
  /* Derived from `contract` against the request's clock, not seeded. */
  | 'contractDaysLeft'
>[] = []

/** Still enrolling or running — what counts as load right now. */
function isRunning(group: Pick<ClassGroupRow, 'status'>): boolean {
  return group.status === 'enrolling' || group.status === 'in_progress'
}

function teacherLoad(teacherId: string) {
  const own = classGroups.filter((group) => group.teacherId === teacherId)
  const running = own.filter(isRunning)
  return {
    activeClassGroups: running.length,
    studentCount: running.reduce((sum, group) => sum + group.seatsTaken, 0),
    pendingGrades: own.reduce((sum, group) => sum + pendingGradesOf(group), 0),
    pendingCertificates: own.reduce((sum, group) => sum + group.pendingCertificates, 0),
  }
}

/**
 * Days left on the contract, against the request's clock. Handed down as a
 * number so the component never computes a date: it would hydrate a different
 * figure than the server rendered.
 */
function contractCountdown(
  contract: TeacherContract | null,
  now: Date,
): { contractDaysLeft: number | null } {
  return {
    contractDaysLeft: contract ? daysUntil(contract.endsAt, now) : null,
  }
}

export function listTeachers(now: Date = new Date()): TeacherRow[] {
  return teachers
    .map(({ availability, ...teacher }) => {
      void availability
      return {
        ...teacher,
        ...teacherLoad(teacher.id),
        ...contractCountdown(teacher.contract, now),
      }
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    )
}

export function getTeacher(
  id: string,
  now: Date = new Date(),
): TeacherDetail | undefined {
  const teacher = teachers.find((item) => item.id === id)
  if (!teacher) return undefined
  return {
    ...teacher,
    ...teacherLoad(teacher.id),
    ...contractCountdown(teacher.contract, now),
    /* Running first, then the finished ones that still owe a certificate:
       the file is opened either to allocate the next class group or to close
       the last one. */
    classGroups: classGroups
      .filter((group) => group.teacherId === id)
      .map((group) => {
        const { students, ...row } = group
        void students
        return { ...row, pendingGrades: pendingGradesOf(group) }
      })
      .sort(
        (a, b) =>
          Number(isRunning(b)) - Number(isRunning(a)) ||
          b.pendingCertificates - a.pendingCertificates ||
          b.startDate.localeCompare(a.startDate),
      ),
  }
}

/* -------------------------------------------------------------------------- */
/* Scoped reads — a teacher sees their own class groups, nobody else's         */
/* -------------------------------------------------------------------------- */

/**
 * The class groups a staff member may list. For a teacher that is their own and
 * only their own (`docs/ARCHITECTURE.md` §3): the filter is built from the
 * session's `teacherId`, never from anything the client sent (CLAUDE.md §8).
 *
 * Here it narrows a mocked array; in production the same rule is the usecase in
 * `packages/domain` behind `apps/api`, and that one is what enforces it.
 */
export function listClassGroupsFor(staff: StaffUser): ClassGroupRow[] {
  const rows = listClassGroups()
  if (staff.role !== 'teacher') return rows
  return rows.filter((group) => group.teacherId === staff.teacherId)
}

/**
 * Reading one class group under the same rule. A teacher asking for somebody
 * else's gets nothing back — not a hidden button, nothing: guessing the id in
 * the URL is the whole point of the check (anti-IDOR, CLAUDE.md §8).
 */
export function getClassGroupFor(
  staff: StaffUser,
  id: string,
): ClassGroupDetail | undefined {
  const group = getClassGroup(id)
  if (!group) return undefined
  if (staff.role === 'teacher' && group.teacherId !== staff.teacherId) return undefined
  return group
}

/**
 * The rosters a staff member may read whole — the teacher's working screen
 * needs every student of every one of their class groups at once. Same rule
 * as the two reads above: the filter comes from the session, and the check
 * that counts is the usecase in `apps/api` (CLAUDE.md §8).
 */
export function listClassGroupRostersFor(staff: StaffUser): ClassGroupDetail[] {
  const rosters = listClassGroupRosters()
  if (staff.role !== 'teacher') return rosters
  return rosters.filter((group) => group.teacherId === staff.teacherId)
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

/** Tolerance and the other pipeline parameters — settings, never constants
 *  in the code (CLAUDE.md §5). Editable from the backoffice. */
export function getPaymentSettings(): PaymentSettings {
  return {
    toleranceCents: 50,
    escalationConfidence: 0.75,
    reservationDays: 5,
    checkoutHoldMinutes: 15,
  }
}

/**
 * Who settled a payment and when, read off the student's own audit trail — the
 * append-only record is the source (CLAUDE.md §8), not a column somebody could
 * set to a different value. No entry means the ladder approved it with no human
 * in the loop.
 */
function decisionOf(
  student: StudentDetail,
  operationNumber: string | null,
): { at: string; by: string } | null {
  const entry = student.activity.find(
    (item) =>
      (item.action === 'payment_approved' || item.action === 'payment_rejected') &&
      item.reference?.kind === 'operation' &&
      item.reference.number === operationNumber,
  )
  return entry ? { at: entry.at, by: entry.actorName } : null
}

/**
 * The whole ledger, newest first. Enrollments and paid procedures land in the
 * same list on purpose: `payments` is agnostic of origin (CLAUDE.md §5), the
 * constancia travels the same states and the same OCR ladder, and the treasury
 * closes the period over both.
 *
 * What the receipt *reads* comes from the review queue when the case is still
 * open; the enrollment only ever carries the frozen plan price, so the two
 * screens can never disagree about the same receipt.
 */
export function listPayments(): PaymentRow[] {
  const queue = listReviewQueue()
  const flags = new Map(
    queue.map((item) => [`${item.studentId}|${item.courseName}`, item]),
  )
  /** Queued receipts already accounted for by an enrollment of their own. */
  const matched = new Set<string>()

  const rows: PaymentRow[] = []

  for (const student of students) {
    const studentName = `${student.firstName} ${student.lastName}`

    for (const item of student.enrollments) {
      const key = `${student.id}|${item.courseName}`
      const open = item.paymentStatus === 'under_review' ? flags.get(key) : undefined
      if (open) matched.add(open.id)
      const decision = decisionOf(student, item.operationNumber)
      rows.push({
        id: `pay_${item.id}`,
        studentId: student.id,
        studentName,
        concept: { kind: 'course', courseName: item.courseName },
        status: item.paymentStatus,
        method: item.paymentMethod,
        amountCents: open?.amountCents ?? item.amountCents,
        expectedAmountCents: item.amountCents,
        currency: item.currency,
        operationNumber: item.operationNumber,
        submittedAt: item.createdAt,
        decidedAt: decision?.at ?? item.paidAt,
        decidedByName: decision?.by ?? null,
        flag: open?.flag ?? null,
      })
    }

    for (const request of student.documentRequests) {
      const decision = decisionOf(student, request.operationNumber)
      rows.push({
        id: `pay_${request.id}`,
        studentId: student.id,
        studentName,
        concept: { kind: 'document', type: request.type },
        status: request.paymentStatus,
        method: request.paymentMethod,
        // A procedure has a fixed fee: what is expected is what it costs, and
        // the receipt is checked against it exactly like a plan price.
        amountCents: request.feeCents,
        expectedAmountCents: request.feeCents,
        currency: request.currency,
        operationNumber: request.operationNumber,
        submittedAt: request.requestedAt,
        decidedAt: decision?.at ?? null,
        decidedByName: decision?.by ?? null,
        flag: null,
      })
    }
  }

  /**
   * A receipt that matches no enrollment of its own is still a payment: a
   * second upload over an already approved enrollment is exactly what tier 0
   * catches. It belongs in the ledger, or the queue would hold receipts nobody
   * can find from the money side.
   */
  for (const item of queue) {
    if (matched.has(item.id)) continue
    rows.push({
      id: `pay_${item.id}`,
      studentId: item.studentId,
      studentName: item.studentName,
      concept: { kind: 'course', courseName: item.courseName },
      status: 'under_review',
      method: item.method,
      amountCents: item.amountCents,
      expectedAmountCents: item.expectedAmountCents,
      currency: 'PEN',
      operationNumber: item.operationNumber,
      submittedAt: item.submittedAt,
      decidedAt: null,
      decidedByName: null,
      flag: item.flag,
    })
  }

  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

/**
 * Period figures, not daily ones: the ciclo is what the treasury closes
 * against, and "collected today" reads as zero every Sunday.
 */
export function getPaymentMetrics(): PaymentMetrics {
  const rows = listPayments()
  const approved = rows.filter((row) => row.status === 'approved')
  return {
    inReview: rows.filter((row) => row.status === 'under_review').length,
    oldestPendingHours: getDashboardMetrics().oldestPendingHours,
    approved: approved.length,
    collectedCents: approved.reduce((total, row) => total + row.amountCents, 0),
    rejected: rows.filter((row) => row.status === 'rejected').length,
    periodName: PERIOD,
  }
}

/** Thirty minutes before the upload — a receipt is photographed after paying. */
function paidAtOf(submittedAt: string): string {
  return new Date(new Date(submittedAt).getTime() - 30 * 60_000).toISOString()
}

/**
 * The extraction behind one queued receipt, built from the queue row itself so
 * the flag, the tier and the confidence on the list are the same ones the
 * reviewer sees when opening it.
 *
 * Every field carries its own confidence and every extraction carries its tier
 * and model (CLAUDE.md §5) — that is what tells a reviewer whether the doubt is
 * about the number or about the picture.
 */
function extractionOf(item: ReviewQueueItem): ReceiptExtraction {
  const { toleranceCents } = getPaymentSettings()
  const unreadable = item.flag === 'illegible'
  /**
   * The queue row promises the lowest per-field confidence, so no field may
   * read below it — a sheet full of higher numbers would make the list lie.
   * The weak field is the one the flag is about: the amount when the value does
   * not match, the operation number in every other case.
   */
  const atLeast = (value: number) => Math.max(value, item.confidence)
  const weakField: ExtractionField =
    item.flag === 'amount_mismatch' ? 'amount' : 'operation_number'

  return {
    paymentId: item.id,
    studentId: item.studentId,
    studentName: item.studentName,
    concept: { kind: 'course', courseName: item.courseName },
    flag: item.flag,
    tier: item.tier,
    modelName: 'Gemini 3.1 Flash-Lite',
    modelVersion: '2026-05',
    imageUrl: null,
    amountCents: item.amountCents,
    expectedAmountCents: item.expectedAmountCents,
    toleranceCents,
    method: item.method,
    submittedAt: item.submittedAt,
    fields: [
      {
        field: 'operation_number',
        value: item.operationNumber
          ? { kind: 'text', text: item.operationNumber }
          : { kind: 'unreadable' },
        confidence:
          weakField === 'operation_number' ? item.confidence : atLeast(0.96),
      },
      {
        field: 'amount',
        value: { kind: 'money', amountCents: item.amountCents, currency: 'PEN' },
        confidence: weakField === 'amount' ? item.confidence : atLeast(0.97),
      },
      {
        field: 'paid_at',
        value: unreadable
          ? { kind: 'unreadable' }
          : { kind: 'timestamp', iso: paidAtOf(item.submittedAt) },
        confidence: unreadable ? item.confidence : atLeast(0.9),
      },
      {
        field: 'payer_name',
        value: unreadable
          ? { kind: 'unreadable' }
          : { kind: 'text', text: item.studentName },
        confidence: unreadable ? item.confidence : atLeast(0.86),
      },
      {
        field: 'method',
        value: { kind: 'method', method: item.method },
        confidence: atLeast(0.99),
      },
    ],
    // Tier 0: the same picture was already approved for somebody else. It is a
    // block, not a doubt — the reviewer is confirming a match, not reading a
    // number.
    duplicateOf:
      item.flag === 'duplicate_phash'
        ? {
            studentName: 'Diego Huamán Ccopa',
            operationNumber: item.operationNumber,
            approvedAt: '2026-07-11T12:34:00Z',
          }
        : null,
    // Tier 2: a model of another family read the same picture. Agreement is
    // the criterion, never the more expensive model (CLAUDE.md §5) — so both
    // readings are shown and neither vendor settles it.
    secondOpinion:
      item.flag === 'model_divergence'
        ? {
            // The whole case is the two readings differing: the digit has to
            // change, whatever the original one was.
            operationNumber: item.operationNumber
              ? `${item.operationNumber.slice(0, -1)}${
                  (Number(item.operationNumber.slice(-1)) + 1) % 10
                }`
              : null,
            amountCents: item.amountCents,
            confidence: 0.61,
          }
        : null,
  }
}

/** Every queued receipt's extraction, keyed by the queue row it belongs to. */
export function listReceiptExtractions(): Record<string, ReceiptExtraction> {
  return Object.fromEntries(
    listReviewQueue().map((item) => [item.id, extractionOf(item)]),
  )
}

/* -------------------------------------------------------------------------- */
/* Enrollments — the ledger of seats, and the reservations still open          */
/* -------------------------------------------------------------------------- */

/**
 * The price in force per course this period. One entry, not a range: there is
 * no discount and no negotiated value (CLAUDE.md §1), so what the backoffice
 * form offers is the same number the student saw on the public page. The real
 * source is the versioned price table, and the enrollment freezes the
 * `plan_price_id` in force (CLAUDE.md §5) — which is why the id travels with
 * the amount and never gets recomputed from it.
 */
const PLAN_PRICES: Record<string, { amountCents: number; planId: string; planPriceId: string }> = {
}

/** The only plan sold today — the whole package, one payment (CLAUDE.md §1). */
const PLAN_NAME = 'Paquete completo'

/**
 * What a course costs right now. Returns null rather than a fallback price: a
 * form that invents an amount is a form that can under-charge somebody, and
 * "this course has no price in force" is the honest answer to give the reader.
 */
export function getPlanPrice(courseName: string): PlanPrice | null {
  const price = PLAN_PRICES[courseName]
  if (!price) return null
  return {
    courseName,
    planName: PLAN_NAME,
    planId: price.planId,
    planPriceId: price.planPriceId,
    amountCents: price.amountCents,
    currency: 'PEN',
  }
}

/** Every price in force, for the form that has to show one without guessing. */
export function listPlanPrices(): PlanPrice[] {
  return Object.keys(PLAN_PRICES)
    .map((courseName) => getPlanPrice(courseName))
    .filter((price): price is PlanPrice => price !== null)
}

/** Course name → the catalog's language, for the ledger filter. */
function languageOf(courseName: string): CourseLanguage | null {
  return courses.find((course) => course.name === courseName)?.language ?? null
}

/**
 * Enrollment id → the class group whose roster claims it. The roster is the
 * join the real schema has as a foreign key; here it is the only honest link,
 * because two class groups of the same course share a course name and would
 * otherwise be told apart by a label.
 */
function classGroupOf(enrollmentId: string): ClassGroupSeed | undefined {
  return classGroups.find((group) =>
    group.students.some((student) => student.enrollmentId === enrollmentId),
  )
}

/**
 * Every enrollment in the institution, newest first — the seat side of what the
 * payments ledger shows as money. The two are deliberately separate screens:
 * `payments` is agnostic of origin and counts constancias alongside courses
 * (CLAUDE.md §5), while this one only ever counts people sitting in a class
 * group, which is what coordination closes the period against.
 */
/**
 * The tracking code the checkout shows the student on its confirmation screen.
 * Derived here from the enrollment id so the mock is stable; the real one is
 * issued by `apps/api` at submit and stored on the row.
 */
function enrollmentCode(id: string, createdAt: string): string {
  const digits = id.replace(/\D/g, '').slice(-4).padStart(4, '0')
  return `OOC-${createdAt.slice(0, 4)}-${digits}`
}

export function listEnrollments(): EnrollmentRow[] {
  const rows: EnrollmentRow[] = []

  for (const student of students) {
    const studentName = `${student.firstName} ${student.lastName}`
    for (const item of student.enrollments) {
      const group = classGroupOf(item.id)
      rows.push({
        id: item.id,
        code: enrollmentCode(item.id, item.createdAt),
        studentId: student.id,
        studentName,
        courseName: item.courseName,
        classGroupId: group?.id ?? null,
        classGroupName: item.classGroupName,
        teacherName: item.teacherName,
        language: group?.language ?? languageOf(item.courseName),
        modality: item.modality,
        academicPeriodName: item.academicPeriodName,
        status: item.status,
        seatStatus: item.seatStatus,
        planName: item.planName,
        planPriceId: item.planPriceId,
        amountCents: item.amountCents,
        currency: item.currency,
        paymentStatus: item.paymentStatus,
        paymentMethod: item.paymentMethod,
        paymentMethodDetail: item.paymentMethodDetail,
        operationNumber: item.operationNumber,
        createdAt: item.createdAt,
        paidAt: item.paidAt,
        progressPct: item.progressPct,
      })
    }
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** An hour, in milliseconds — the unit the reservation countdown is read in. */
const HOUR_MS = 3_600_000

/** Inside this many hours of expiry, a reservation is worth chasing today. */
export const RESERVATION_WARNING_HOURS = 24

/**
 * The seats currently held by an unsettled payment, soonest to expire first.
 * The deadline is the reservation window from the payment settings
 * (CLAUDE.md §5) counted from when the seat was taken — the same number the
 * cron releases against, read from one place so the screen cannot promise a
 * day the job does not honour.
 *
 * `now` is a parameter so the page passes the request's clock: computing it
 * inside a component would hydrate a different countdown than it rendered.
 */
export function listSeatReservations(now: Date = new Date()): SeatReservation[] {
  const windowMs = getPaymentSettings().reservationDays * 24 * HOUR_MS
  const queue = listReviewQueue()

  return listEnrollments()
    .filter((row) => row.seatStatus === 'reserved')
    .map((row) => {
      const expiresAt = new Date(new Date(row.createdAt).getTime() + windowMs)
      const open = queue.find(
        (item) =>
          item.studentId === row.studentId && item.courseName === row.courseName,
      )
      return {
        enrollmentId: row.id,
        studentId: row.studentId,
        studentName: row.studentName,
        courseName: row.courseName,
        classGroupName: row.classGroupName,
        classGroupId: row.classGroupId,
        paymentStatus: row.paymentStatus,
        flag: open?.flag ?? null,
        // The queued receipt itself, so the row can open that one instead of
        // handing the reader the whole queue back.
        reviewId: open?.id ?? null,
        amountCents: row.amountCents,
        currency: row.currency,
        reservedAt: row.createdAt,
        expiresAt: expiresAt.toISOString(),
        hoursLeft: Math.floor((expiresAt.getTime() - now.getTime()) / HOUR_MS),
      }
    })
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}

/** Period figures for the section header. */
export function getEnrollmentMetrics(now: Date = new Date()): EnrollmentMetrics {
  const rows = listEnrollments()
  const reservations = listSeatReservations(now)
  return {
    periodName: PERIOD,
    total: rows.length,
    active: rows.filter((row) => row.status === 'active').length,
    reserved: reservations.length,
    expiringSoon: reservations.filter(
      (item) => item.hoursLeft <= RESERVATION_WARNING_HOURS,
    ).length,
    released: rows.filter((row) => row.seatStatus === 'released').length,
  }
}

/* -------------------------------------------------------------------------- */
/* E-mail                                                                      */
/* -------------------------------------------------------------------------- */

/** The window every figure on the e-mail screen is measured over. */
const EMAIL_WINDOW_DAYS = 30

/**
 * One sample per audience, shared by every flow written to it. The preview is
 * read by staff to check wording, so it renders over invented people — a real
 * student's name has no business on that screen (CLAUDE.md §8).
 */
const studentSample = {
  studentName: 'María Fernanda Quispe Rojas',
  studentEmail: 'maria.quispe@gmail.com',
  guardianName: 'Rosa Elena Rojas Sánchez',
  guardianEmail: 'rosa.rojas@gmail.com',
  teacherName: 'Elena Ríos Salazar',
  teacherEmail: 'elena.rios@onlyonecoin.edu.pe',
  staffName: 'Lucía Ramírez',
  staffEmail: 'lucia.ramirez@onlyonecoin.edu.pe',
  courseName: 'Inglés Básico A1',
  classGroupName: 'A1 — Lun/Mié 18:00',
  amountCents: 6990,
  date: '2026-09-07T23:00:00Z',
}

/**
 * The transactional catalog. Every entry is an e-mail that leaves on its own,
 * as the consequence of something the domain did — there is no send button per
 * message (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4).
 *
 * The counts are the last 30 days as the provider reported them back. They sit
 * next to each other on purpose: a flow whose bounces climb is one whose
 * addresses are wrong, and that only shows against its own volume.
 */
export function listEmailFlows(): EmailFlow[] {
  return [
    {
      template: 'enrollment_submitted',
      audience: 'student',
      stage: 'submitted',
      conditional: false,
      enabled: true,
      version: 4,
      updatedAt: '2026-08-04T14:20:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'guardian_consent_reminder',
      audience: 'guardian',
      stage: 'submitted',
      conditional: true,
      enabled: true,
      version: 2,
      updatedAt: '2026-07-18T13:00:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'payment_under_review',
      audience: 'student',
      stage: 'payment_pending',
      conditional: true,
      enabled: true,
      version: 2,
      updatedAt: '2026-07-22T16:05:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'seat_reservation_expiring',
      audience: 'student',
      stage: 'payment_pending',
      conditional: true,
      enabled: true,
      version: 1,
      updatedAt: '2026-08-16T10:05:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'payment_approved',
      audience: 'student',
      stage: 'payment_settled',
      conditional: false,
      enabled: true,
      version: 5,
      updatedAt: '2026-08-11T11:40:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'payment_rejected',
      audience: 'student',
      stage: 'payment_settled',
      conditional: true,
      enabled: true,
      version: 3,
      updatedAt: '2026-07-30T09:15:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'credentials_issued',
      audience: 'student',
      stage: 'access',
      conditional: false,
      enabled: true,
      version: 6,
      updatedAt: '2026-08-14T18:30:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      /* On, like every other flow here. It used to ship off, to show the
         journey what a pause costs — three days before the class group
         starts, nobody gets the Classroom link (`docs/REGRAS-NEGOCIO.md` §8).
         But a panel nobody has touched saying an e-mail is paused is an
         invented fact about this institution, and the catalog is not the place
         to demonstrate states (owner's rule: the panel starts clean). The
         paused look still exists — it draws the day somebody actually pauses
         one. */
      template: 'class_access_ready',
      audience: 'student',
      stage: 'access',
      conditional: false,
      enabled: true,
      version: 2,
      updatedAt: '2026-08-02T15:45:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'enrollment_certificate_issued',
      audience: 'student',
      stage: 'documents',
      conditional: true,
      enabled: true,
      version: 3,
      updatedAt: '2026-08-09T12:10:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'certificate_issued',
      audience: 'student',
      stage: 'documents',
      conditional: false,
      enabled: true,
      version: 4,
      updatedAt: '2026-08-12T17:25:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },

    /* Internal. Small volumes — there are two dozen teachers, not five
       thousand students — and no stage: none of these is a step of the
       student's journey. */
    {
      template: 'teacher_credentials_issued',
      audience: 'teacher',
      stage: null,
      conditional: false,
      enabled: true,
      version: 2,
      updatedAt: '2026-07-28T15:10:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'teacher_class_group_assigned',
      audience: 'teacher',
      stage: null,
      conditional: false,
      enabled: true,
      version: 3,
      updatedAt: '2026-08-06T10:35:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      /* 45 days out, the number the panel already watches
         (`CONTRACT_ALERT_DAYS`, CLAUDE.md §1 — provisional). */
      template: 'teacher_contract_expiring',
      audience: 'teacher',
      stage: null,
      conditional: true,
      enabled: true,
      version: 1,
      updatedAt: '2026-08-19T09:00:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      template: 'teacher_grades_pending',
      audience: 'teacher',
      stage: null,
      conditional: true,
      enabled: true,
      version: 2,
      updatedAt: '2026-08-15T13:20:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
    {
      /* The batch is never fired by a date — the list is prepared and
         coordination confirms it (`docs/DOCUMENTOS-E-CERTIFICADOS.md`). This
         e-mail is what tells them the list is ready. */
      template: 'staff_certificates_ready',
      audience: 'staff',
      stage: null,
      conditional: false,
      enabled: true,
      version: 1,
      updatedAt: '2026-08-17T16:40:00Z',
      metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
      sample: studentSample,
    },
  ]
}

/** The header figures — the same window, summed over the catalog. */
export function getEmailMetrics(): EmailMetrics {
  const flows = listEmailFlows()
  return {
    windowDays: EMAIL_WINDOW_DAYS,
    sent: flows.reduce((total, flow) => total + flow.metrics.sent, 0),
    delivered: flows.reduce((total, flow) => total + flow.metrics.delivered, 0),
    bounced: flows.reduce((total, flow) => total + flow.metrics.bounced, 0),
    failed: flows.reduce((total, flow) => total + flow.metrics.failed, 0),
    paused: flows.filter((flow) => !flow.enabled).length,
  }
}

/** One flow, by the template it renders — the id the detail route carries. */
export function getEmailFlow(template: string): EmailFlow | undefined {
  return listEmailFlows().find((flow) => flow.template === template)
}

/**
 * How many people a manual send would reach, resolved against the enrollment
 * ledger the same way the real query will: the segment is a question answered
 * at send time, never a list kept at the provider (`docs/ROADMAP.md` fase 5).
 *
 * Counted by student, not by enrollment — somebody enrolled in two courses is
 * one person receiving one e-mail.
 */
export function countEmailRecipients(segment: EmailSegment): number {
  const rows = listEnrollments().filter((row) => {
    switch (segment.kind) {
      case 'all':
        return true
      case 'course':
        return row.courseName === segment.courseName
      case 'class_group':
        return row.classGroupId === segment.classGroupId
      case 'enrollment_status':
        return row.status === segment.status
    }
  })
  return new Set(rows.map((row) => row.studentId)).size
}

/**
 * The deliveries that did not land, newest first. Not a report: it is a list of
 * people the institution failed to reach — the student whose credentials
 * bounced cannot get into the portal, and nobody finds that out from a counter.
 *
 * Empty, like every other fixture in this file: the panel starts clean, never
 * populated with invented people (owner's rule). These rows arrive from the
 * `outbox` and what the provider reports back about each send (CLAUDE.md §5),
 * so until that pipe exists the screen shows its empty state — which is the
 * truth, and is also what "nobody was failed today" will look like.
 */
export function listEmailDeliveryIssues(): EmailDeliveryIssue[] {
  return []
}
