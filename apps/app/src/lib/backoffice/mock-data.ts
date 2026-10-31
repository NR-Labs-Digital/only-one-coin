import { EMAIL_CATALOG, EMAIL_CATALOG_KEYS } from '@ooc/domain/email-catalog'
import { isEmailFlowPaused } from './email-journey'
import type {
  ClassGroupDetail,
  ClassGroupRow,
  ClassGroupStudent,
  CourseLanguage,
  CourseRow,
  EnrollmentRow,
  EmailFlow,
  EmailMetrics,
  EmailSegment,
  EmailTemplate,
  PlanPrice,
  StudentDetail,
} from './types'

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

const students: StudentDetail[] = []

/* -------------------------------------------------------------------------- */
/* Class groups                                                                */
/* -------------------------------------------------------------------------- */

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

type ClassGroupSeed = Omit<ClassGroupDetail, 'pendingGrades' | 'students' | 'notices'> & {
  students: ClassGroupStudentSeed[]
  notices?: ClassGroupDetail['notices']
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
    const { students, notices, ...row } = group
    void students
    void notices
    return { ...row, pendingGrades: pendingGradesOf(group) }
  })
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
    notices: group.notices ?? [],
    pendingGrades: pendingGradesOf(group),
  }))
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */


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
        modality: 'online',
        academicPeriodName: item.academicPeriodName,
        classGroupStatus: group?.status ?? 'enrolling',
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
        progressPct: null,
      })
    }
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/* -------------------------------------------------------------------------- */
/* E-mail                                                                      */
/* -------------------------------------------------------------------------- */

/** The window every figure on the e-mail screen is measured over. */
const EMAIL_WINDOW_DAYS = 30

/**
 * One sample for every flow. The preview is read by staff to check wording, so
 * it renders over invented people — a real student's name has no business on
 * that screen (CLAUDE.md §8).
 */
const emailSample = {
  studentName: 'María Fernanda Quispe Rojas',
  studentEmail: 'maria.quispe@gmail.com',
  staffName: 'Lucía Ramírez',
  staffEmail: 'lucia.ramirez@onlyonecoin.edu.pe',
  courseName: 'Inglés Básico A1',
  classGroupName: 'A1 — Lun/Mié 18:00',
  amountCents: 6990,
  date: '2026-09-07T23:00:00Z',
}

/**
 * What the catalog does not say about a flow: the template's version and the
 * provider's switch. Mocked until OOC-88 reads them from the repository.
 */
const emailFlowState: Record<EmailTemplate, { version: number; updatedAt: string; enabled: boolean }> = {
  enrollment_received: { version: 4, updatedAt: '2026-08-04T14:20:00Z', enabled: true },
  payment_under_review: { version: 2, updatedAt: '2026-07-22T16:05:00Z', enabled: true },
  payment_approved: { version: 5, updatedAt: '2026-08-11T11:40:00Z', enabled: true },
  payment_rejected: { version: 3, updatedAt: '2026-07-30T09:15:00Z', enabled: true },
  portal_credentials: { version: 6, updatedAt: '2026-08-14T18:30:00Z', enabled: true },
  class_access_ready: { version: 1, updatedAt: '2026-08-02T15:45:00Z', enabled: false },
  enrollment_certificate_issued: { version: 1, updatedAt: '2026-08-09T12:10:00Z', enabled: false },
  certificate_issued: { version: 1, updatedAt: '2026-08-12T17:25:00Z', enabled: false },
  email_verification_code: { version: 1, updatedAt: '2026-10-07T12:00:00Z', enabled: true },
  portal_password_reset: { version: 1, updatedAt: '2026-10-05T12:00:00Z', enabled: true },
  staff_password_reset: { version: 1, updatedAt: '2026-09-30T12:00:00Z', enabled: true },
  staff_mfa_code: { version: 1, updatedAt: '2026-10-14T12:00:00Z', enabled: true },
}

/**
 * The transactional catalog. Every entry is an e-mail that leaves on its own,
 * as the consequence of something the domain did — there is no send button per
 * message (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4). Who it is written to, where
 * it fires and whether anything sends it yet come from the one catalog the API
 * also reads (OOC-87); a template nothing sends yet is never switched on.
 *
 * The counts are the last 30 days as the provider reported them back. They sit
 * next to each other on purpose: a flow whose bounces climb is one whose
 * addresses are wrong, and that only shows against its own volume.
 */
export function listEmailFlows(): EmailFlow[] {
  return EMAIL_CATALOG_KEYS.map((template) => ({
    template,
    ...EMAIL_CATALOG[template],
    ...emailFlowState[template],
    metrics: { sent: 0, delivered: 0, bounced: 0, failed: 0 },
    sample: emailSample,
  }))
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
    paused: flows.filter(isEmailFlowPaused).length,
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

