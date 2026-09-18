import type { StaffRole, StaffUser } from './types'

/**
 * Screen-level gates. These decide what a staff member *sees*, never what they
 * are allowed to do: the real check is deny-by-default in `apps/api`, where
 * every route declares its role (CLAUDE.md §8). Hiding a button is defense in
 * depth, not the defense.
 *
 * The cargo map (owner's decision, 07/09/2026):
 * - `master` — the platform owners' cargo, everything everywhere. Only an
 *   account on the owners' e-mail domain may hold it (`canHoldMaster`).
 * - `admin` — sees everything, authorizes everything.
 * - `analyst` — the administrator's assistant: observes every area to check it
 *   is ok and proposes fixes, but approves and edits nothing.
 * - `enrollment_supervisor` — everything academic on the enrollment side:
 *   students, enrollments (manual included), courses and class groups.
 * - `academic_supervisor` — supervises the teachers.
 * - `teacher` — runs their own class groups, nothing else.
 * - `sales` — follows the enrollments their WhatsApp sales become.
 * - `support` — answers students: reads people, enrollments and payments.
 * - `billing` — settles money; no academic data beyond what a receipt carries.
 */

/**
 * The owners' e-mail domains — the only accounts allowed to hold `master`.
 * Mirrors `packages/domain/src/identity/Role.ts` (apps/app never imports that
 * package, CLAUDE.md §3) — keep the two lists in sync by hand.
 */
export const MASTER_EMAIL_DOMAINS = ['nrlabsdigital.com', 'admin.com'] as const

/** Whether this e-mail belongs to the platform owners. */
export function isOwnerEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return MASTER_EMAIL_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`))
}

/** Whether this e-mail is allowed to carry the `master` cargo. */
export function canHoldMaster(email: string): boolean {
  return isOwnerEmail(email)
}

/**
 * Who opens Funcionalidades — the switchboard that says which sections of the
 * platform are on the air (CLAUDE.md §5).
 *
 * The only gate in this file that reads an e-mail instead of a cargo, and
 * deliberately so: what exists is a decision of whoever runs the platform, not
 * of whoever runs the school. An `admin` of the Asociación authorizes
 * everything academic and none of this; an owner opens it whatever cargo their
 * account carries. As everywhere else here, this only draws the screen — the
 * check that counts is `.owners()` on the route in `apps/api`.
 */
export function canManageFeatureFlags(email: string): boolean {
  return isOwnerEmail(email)
}

/** The two cargos that run the platform itself. */
function isManagement(role: StaffRole): boolean {
  return role === 'master' || role === 'admin'
}

/** Only management and the enrollment side open a class group. */
export function canCreateClassGroup(role: StaffRole): boolean {
  return (
    isManagement(role) ||
    role === 'enrollment_supervisor' ||
    role === 'academic_supervisor'
  )
}

/**
 * Who may issue a document or fire the batch. A teacher can, but only for their
 * own class groups — that scope check lives in the usecase, comparing the
 * authenticated `teacher_id` against the class group's (CLAUDE.md §8).
 */
export function canIssueCertificates(role: StaffRole): boolean {
  return (
    isManagement(role) ||
    role === 'enrollment_supervisor' ||
    role === 'academic_supervisor' ||
    role === 'teacher'
  )
}

/**
 * Who may record an administrative procedure over an enrollment — moving,
 * freezing, withdrawing (`docs/REGRAS-NEGOCIO.md` §5). They all carry a fee and
 * touch a seat, so they belong to management and the enrollment side.
 */
export function canManageEnrollment(role: StaffRole): boolean {
  return isManagement(role) || role === 'enrollment_supervisor'
}

/**
 * Opening a course is a management call: it is what the whole catalog, the
 * price table and every future class group hang off.
 */
export function canCreateCourse(role: StaffRole): boolean {
  return isManagement(role)
}

/** Who may change a course's options — not the same as who may create one. */
export function canConfigureCourse(role: StaffRole): boolean {
  return isManagement(role) || role === 'enrollment_supervisor'
}

/**
 * Who opens the payments section at all. Billing settles, the analyst observes,
 * support answers "did my payment go through" — and nobody academic-only needs
 * the money screens.
 */
export function canViewPayments(role: StaffRole): boolean {
  return (
    isManagement(role) ||
    role === 'analyst' ||
    role === 'billing' ||
    role === 'support'
  )
}

/**
 * Who may settle a receipt the ladder could not. Management authorizes and
 * billing settles; the analyst sees the queue but never approves — that is the
 * whole definition of the cargo. The enforcing check is the role declared on
 * the `apps/api` usecase — this only decides whether the button is drawn.
 */
export function canReviewPayments(role: StaffRole): boolean {
  return isManagement(role) || role === 'billing'
}

/**
 * Who opens the teacher roster. The academic supervisor exists to supervise
 * the docentes; the analyst reads it, management runs it.
 */
export function canManageTeachers(role: StaffRole): boolean {
  return (
    isManagement(role) || role === 'academic_supervisor' || role === 'analyst'
  )
}

/**
 * Who registers a new teacher. Management only: a teacher record is an account
 * that will read student grades, and creating one is one step away from
 * creating staff — which `CLAUDE.md` §8 puts behind a dedicated usecase.
 */
export function canCreateTeacher(role: StaffRole): boolean {
  return isManagement(role)
}

/**
 * Who may browse the whole student directory. A teacher sees the students of
 * their own class groups, reached through the class group; billing settles
 * money and has no business in the directory.
 */
export function canBrowseStudents(role: StaffRole): boolean {
  return role !== 'teacher' && role !== 'billing'
}

/**
 * Who registers a student by hand. The documented way in is the student filling
 * `/enrollment` themselves (CLAUDE.md §1); this covers the person who closed
 * the sale on WhatsApp and never reached the form. A registration carries the
 * guardian record and the consent behind it (Ley 29733, CLAUDE.md §8), so it
 * stays with management and the enrollment side.
 */
export function canCreateStudent(role: StaffRole): boolean {
  return isManagement(role) || role === 'enrollment_supervisor'
}

/**
 * Who records a final grade — the teacher of that class group, nobody else.
 * The grade is what the docente signs, and everything downstream reads it: the
 * certificate (grade ≥ 14, `docs/REGRAS-NEGOCIO.md` §3) and the module
 * progression both hang off it. As everywhere else this only decides whether
 * the roster draws inputs: the enforcing check compares the authenticated
 * `teacher_id` against the class group inside the usecase (CLAUDE.md §8).
 */
export function canRecordGrades(
  staff: Pick<StaffUser, 'role' | 'teacherId'>,
  group: { teacherId: string },
): boolean {
  return staff.role === 'teacher' && staff.teacherId === group.teacherId
}

/**
 * Whether the panel must be narrowed to the signed-in teacher's own class
 * groups (`docs/ARCHITECTURE.md` §3). The screen honours it so the reader is
 * not shown doors that would fail; the enforcing check compares the
 * authenticated `teacher_id` against the class group inside the usecase, and it
 * is the only one that counts (CLAUDE.md §8).
 */
export function isRestrictedToOwnClassGroups(role: StaffRole): boolean {
  return role === 'teacher'
}

/**
 * Who may read the enrollment ledger. The enrollment side owns it, the
 * academic supervisor reads the class groups it feeds, the analyst observes,
 * and sales and support answer for the enrollments people ask them about.
 * Billing settles money in the payments section; a teacher sees their own
 * class groups, one at a time (CLAUDE.md §8).
 */
export function canBrowseEnrollments(role: StaffRole): boolean {
  return (
    isManagement(role) ||
    role === 'analyst' ||
    role === 'enrollment_supervisor' ||
    role === 'academic_supervisor' ||
    role === 'sales' ||
    role === 'support'
  )
}

/**
 * Who may read the reports — the ledger summed up. Management, the two
 * supervisors and the analyst; billing's own figure — what came in this ciclo —
 * is on the payments section, next to the receipts it settles.
 */
export function canBrowseReports(role: StaffRole): boolean {
  return (
    isManagement(role) ||
    role === 'analyst' ||
    role === 'enrollment_supervisor' ||
    role === 'academic_supervisor'
  )
}

/**
 * Who may open an enrollment from the panel. The documented way in is the
 * student filling `/enrollment` themselves (CLAUDE.md §1); this is the
 * exception for the sale that closed on WhatsApp and never reached the form.
 */
export function canCreateEnrollment(role: StaffRole): boolean {
  return isManagement(role) || role === 'enrollment_supervisor'
}

/**
 * Who opens the team directory — the panel's own accounts and their cargos.
 * Management only: it is the surface where a cargo changes, and the
 * anti-escalation rule keeps that with the top of the house (CLAUDE.md §8).
 */
export function canManageStaff(role: StaffRole): boolean {
  return isManagement(role)
}

/**
 * Who opens the e-mail module. The catalog decides what every student receives
 * at the moment their enrollment moves, so it belongs to management and the
 * enrollment side; the analyst reads it.
 */
export function canManageEmail(role: StaffRole): boolean {
  return (
    isManagement(role) || role === 'enrollment_supervisor' || role === 'analyst'
  )
}

/**
 * Who opens the platform settings. Management only: that screen holds the grade
 * that decides who is certified and the tolerance the platform approves a
 * receipt with when nobody is looking.
 */
export function canConfigureSettings(role: StaffRole): boolean {
  return isManagement(role)
}

/**
 * Whose second factor is not optional (CLAUDE.md §8). These cargos move money
 * or hand out roles, so the panel never offers them a switch to turn it off.
 * The enforcing check is the session policy in `apps/api`.
 */
export function isMfaMandatory(role: StaffRole): boolean {
  return isManagement(role) || role === 'billing'
}
