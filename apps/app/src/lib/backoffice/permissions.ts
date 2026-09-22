import type { StaffRole, StaffUser } from './types'
import { isRoleAllowed } from './role-permissions'

/**
 * Screen-level gates. These decide what a staff member *sees*, never what they
 * are allowed to do: the real check is deny-by-default in `apps/api`, where
 * every route declares its role (CLAUDE.md §8). Hiding a button is defense in
 * depth, not the defense.
 *
 * Every gate below asks the same question of the same place — does this cargo
 * hold this capability (`capabilities.ts`, resolved in `role-permissions.ts`)?
 * The cargo lists used to be typed into each function here, which meant that
 * letting `sales` register a student was a commit and a deploy. They are now
 * the *defaults*: admin moves them on `/backoffice/team/permissions`, and the
 * functions keep their names so no screen had to change.
 *
 * The cargo map (owner's decision, 07/09/2026) — what each one is for, which
 * is also why the defaults are what they are:
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
 *
 * Two of these are not opinions the matrix can change. `master` and `admin`
 * hold everything by construction (`ALWAYS_ALLOWED_ROLES`), and a docente's
 * scope — their own class groups and nothing else — is a comparison inside the
 * usecase, which is why it is not a capability at all.
 */

export {
  MASTER_EMAIL_DOMAINS,
  isOwnerEmail,
  canHoldMaster,
  canManageFeatureFlags,
} from './owners'

/** Only management and the enrollment side open a class group, by default. */
export function canCreateClassGroup(role: StaffRole): boolean {
  return isRoleAllowed(role, 'class_groups_create')
}

/**
 * Who may issue a document or fire the batch. A teacher can, but only for their
 * own class groups — that scope check lives in the usecase, comparing the
 * authenticated `teacher_id` against the class group's (CLAUDE.md §8), and no
 * switch on the permissions screen relaxes it.
 */
export function canIssueCertificates(role: StaffRole): boolean {
  return isRoleAllowed(role, 'certificates_issue')
}

/**
 * Who may record an administrative procedure over an enrollment — moving,
 * freezing, withdrawing (`docs/REGRAS-NEGOCIO.md` §5). They all carry a fee and
 * touch a seat, so by default they belong to management and the enrollment side.
 */
export function canManageEnrollment(role: StaffRole): boolean {
  return isRoleAllowed(role, 'enrollments_manage')
}

/**
 * Opening a course is a management call by default: it is what the whole
 * catalog, the price table and every future class group hang off.
 */
export function canCreateCourse(role: StaffRole): boolean {
  return isRoleAllowed(role, 'courses_create')
}

/** Who may change a course's options — not the same as who may create one. */
export function canConfigureCourse(role: StaffRole): boolean {
  return isRoleAllowed(role, 'courses_configure')
}

/**
 * Who opens the payments section at all. Billing settles, the analyst observes,
 * support answers "did my payment go through" — and nobody academic-only needs
 * the money screens.
 */
export function canViewPayments(role: StaffRole): boolean {
  return isRoleAllowed(role, 'payments_view')
}

/**
 * Who may settle a receipt the ladder could not. Management authorizes and
 * billing settles; the analyst reads the queue and by default never approves —
 * that is the whole definition of the cargo. The enforcing check is the role
 * declared on the `apps/api` usecase — this only decides whether the button is
 * drawn.
 */
export function canReviewPayments(role: StaffRole): boolean {
  return isRoleAllowed(role, 'payments_review')
}

/**
 * Who opens the teacher roster. The academic supervisor exists to supervise
 * the docentes; the analyst reads it, management runs it.
 */
export function canManageTeachers(role: StaffRole): boolean {
  return isRoleAllowed(role, 'teachers_manage')
}

/**
 * Who registers a new teacher. Management by default: a teacher record is an
 * account that will read student grades, and creating one is one step away from
 * creating staff — which `CLAUDE.md` §8 puts behind a dedicated usecase.
 */
export function canCreateTeacher(role: StaffRole): boolean {
  return isRoleAllowed(role, 'teachers_create')
}

/**
 * Who may browse the whole student directory. A teacher sees the students of
 * their own class groups, reached through the class group; billing settles
 * money and has no business in the directory.
 */
export function canBrowseStudents(role: StaffRole): boolean {
  return isRoleAllowed(role, 'students_browse')
}

/**
 * Who registers a student by hand. The documented way in is the student filling
 * `/enrollment` themselves (CLAUDE.md §1); this covers the person who closed
 * the sale on WhatsApp and never reached the form. A registration carries the
 * guardian record and the consent behind it (Ley 29733, CLAUDE.md §8), which is
 * why it starts with management and the enrollment side.
 */
export function canCreateStudent(role: StaffRole): boolean {
  return isRoleAllowed(role, 'students_create')
}

/**
 * Who records a final grade — the teacher of that class group, nobody else.
 * The grade is what the docente signs, and everything downstream reads it: the
 * certificate (grade ≥ 14, `docs/REGRAS-NEGOCIO.md` §3) and the module
 * progression both hang off it. Scope, not a capability: this is never on the
 * permissions matrix, because the enforcing check compares the authenticated
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
 * groups (`docs/ARCHITECTURE.md` §3). Scope again, and for the same reason:
 * the screen honours it so the reader is not shown doors that would fail; the
 * enforcing check compares the authenticated `teacher_id` against the class
 * group inside the usecase, and it is the only one that counts (CLAUDE.md §8).
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
  return isRoleAllowed(role, 'enrollments_browse')
}

/**
 * Who may read the reports — the ledger summed up. Management, the two
 * supervisors and the analyst; billing's own figure — what came in this ciclo —
 * is on the payments section, next to the receipts it settles.
 */
export function canBrowseReports(role: StaffRole): boolean {
  return isRoleAllowed(role, 'reports_browse')
}

/**
 * Who may open an enrollment from the panel. The documented way in is the
 * student filling `/enrollment` themselves (CLAUDE.md §1); this is the
 * exception for the sale that closed on WhatsApp and never reached the form.
 */
export function canCreateEnrollment(role: StaffRole): boolean {
  return isRoleAllowed(role, 'enrollments_create')
}

/**
 * Who opens the team directory — the panel's own accounts, their cargos, and
 * the matrix that says what each cargo opens. Management alone, and the one
 * capability the matrix itself cannot hand out: it is the surface where a cargo
 * changes, so giving it away would be giving everything else away with it
 * (CLAUDE.md §8).
 */
export function canManageStaff(role: StaffRole): boolean {
  return isRoleAllowed(role, 'team_manage')
}

/**
 * Who opens the e-mail module. The catalog decides what every student receives
 * at the moment their enrollment moves, so it belongs to management and the
 * enrollment side; the analyst reads it.
 */
export function canManageEmail(role: StaffRole): boolean {
  return isRoleAllowed(role, 'email_manage')
}

/**
 * Who opens the platform settings. Management by default: that screen holds the
 * grade that decides who is certified and the tolerance the platform approves a
 * receipt with when nobody is looking.
 */
export function canConfigureSettings(role: StaffRole): boolean {
  return isRoleAllowed(role, 'settings_configure')
}

/**
 * Whose second factor is not optional (CLAUDE.md §8). These cargos move money
 * or hand out roles, so the panel never offers them a switch to turn it off.
 * Not a capability either — it is a requirement placed on a cargo, not a door
 * opened for one, and the enforcing check is the session policy in `apps/api`.
 */
export function isMfaMandatory(role: StaffRole): boolean {
  return role === 'master' || role === 'admin' || role === 'billing'
}
