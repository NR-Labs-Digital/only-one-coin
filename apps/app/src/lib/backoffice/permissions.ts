import type { PermissionKey } from '@ooc/domain/permission-catalog'
import type { StaffRole } from './types'

/**
 * What a screen needs to know about who is looking: the cargo, and what that
 * cargo can do (OOC-183) — the permissions `/me` returns, read the same way
 * the API's authorization hook reads them. `StaffUser` is one.
 */
export interface StaffAccess {
  role: StaffRole
  permissions: readonly string[]
}

function has(staff: StaffAccess, permission: PermissionKey): boolean {
  return staff.permissions.includes(permission)
}

/**
 * Screen-level gates. These decide what a staff member *sees*, never what they
 * are allowed to do: the real check is deny-by-default in `apps/api`, where
 * every route declares the permission it needs (CLAUDE.md §8). Hiding a button
 * is defense in depth, not the defense.
 *
 * Since OOC-183 every gate reads a permission of the session's cargo — the
 * same key the route declares — never the cargo's name, because what a cargo
 * can do is edited in Equipo. The board below is what each cargo holds by
 * default (`packages/domain/src/identity/permissionCatalog.ts`).
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
 * - `academic_assistant` — runs the teachers day to day (OOC-96): manages the
 *   roster and the files, reads the class groups, the teachers' week and their
 *   grades, and never posts or corrects a grade.
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

/**
 * Who opens and runs class groups and their module runs — create, edit, move
 * the status along, assign teacher, Classroom and Meet. The roles the API
 * declares as CLASS_GROUP_WRITE_ROLES: the enrollment side plus the academic
 * supervisor (OOC-95, decision of 20/11/2026), who allocates the teachers.
 * Periods, retiring and the waitlist are not part of it (`canManagePeriods`,
 * `canRetireCatalogEntry`, `canManageWaitlist`).
 */
export function canCreateClassGroup(staff: StaffAccess): boolean {
  return has(staff, 'catalog.class_groups_edit')
}

/**
 * Who opens, edits and duplicates academic periods — CATALOG_WRITE_ROLES. The
 * academic supervisor runs class groups inside a period, not the period.
 */
export function canManagePeriods(staff: StaffAccess): boolean {
  return has(staff, 'catalog.periods')
}

/**
 * Who reads and runs a class group's waitlist — it carries each person's
 * national id, so it follows the student file's readers, not who runs the
 * class group (the API gates it with CATALOG_WRITE_ROLES).
 */
export function canManageWaitlist(staff: StaffAccess): boolean {
  return has(staff, 'catalog.waitlist')
}

/**
 * Who may act on an enrollment's seat — moving it to another class group
 * (OOC-84, a free staff tool, the same three the API declares on
 * `POST /enrollments/:id/move`), and later freezing or withdrawing it
 * (`docs/REGRAS-NEGOCIO.md` §5). They touch a seat, so they belong to
 * management and the enrollment side.
 */
export function canManageEnrollment(staff: StaffAccess): boolean {
  return has(staff, 'enrollments.move')
}

/**
 * Opening a course is a management call: it is what the whole catalog, the
 * price table and every future class group hang off.
 */
export function canCreateCourse(staff: StaffAccess): boolean {
  return has(staff, 'catalog.courses_create')
}

/** Who may change a course's options — not the same as who may create one. */
export function canConfigureCourse(staff: StaffAccess): boolean {
  return has(staff, 'catalog.course_options')
}

/**
 * Who takes a course, plan, class group or period off the catalog and puts it
 * back — the roles the API declares on retire/restore (CLAUDE.md §1, "quem
 * aposenta e reativa é quem abre turma"). Billing settles money; it does not
 * decide what stops being sold.
 */
export function canRetireCatalogEntry(staff: StaffAccess): boolean {
  return has(staff, 'catalog.retire')
}

/**
 * Who opens the payments section at all. Billing settles, the analyst observes,
 * support answers "did my payment go through" — and nobody academic-only needs
 * the money screens.
 */
export function canViewPayments(staff: StaffAccess): boolean {
  return has(staff, 'payments.view')
}

/**
 * Who opens a receipt image — the reviewers and the analyst who observes them.
 * The image is personal data and every opening is an audited read; `support`
 * reads payments but never the picture. Mirrors `PAYMENT_RECEIPT_ROLES`
 * (apps/api/src/http/payment/paymentRoles.ts), which is what enforces it.
 */
export function canOpenReceiptImage(staff: StaffAccess): boolean {
  return has(staff, 'payments.view_receipt')
}

/**
 * Who may settle a receipt the ladder could not. Management authorizes and
 * billing settles; the analyst sees the queue but never approves — that is the
 * whole definition of the cargo. The enforcing check is the role declared on
 * the `apps/api` usecase — this only decides whether the button is drawn.
 */
export function canReviewPayments(staff: StaffAccess): boolean {
  return has(staff, 'payments.settle')
}

/**
 * Who opens the teacher roster. The academic supervisor exists to supervise
 * the docentes and the academic assistant runs them day to day (OOC-96); the
 * analyst reads it, management runs it.
 */
export function canManageTeachers(staff: StaffAccess): boolean {
  return has(staff, 'teachers.view')
}

/**
 * Who corrects a teacher file, its week and its place on the roster. The
 * roster's readers minus the analyst, who observes and proposes but never
 * edits (CLAUDE.md §8). Mirrors TEACHER_EDIT_ROLES in apps/api.
 */
export function canEditTeachers(staff: StaffAccess): boolean {
  return has(staff, 'teachers.edit')
}

/**
 * Who reads a class group's grades in the backoffice (OOC-102): the academic
 * supervision and management, and the analyst and the academic assistant
 * (OOC-96), who read and never write. Mirrors GRADE_READ_ROLES in apps/api.
 */
export function canReadGrades(staff: StaffAccess): boolean {
  return has(staff, 'grades.view')
}

/**
 * Who posts a missing grade and corrects a posted one (OOC-102, decision of
 * 10/11/2026). The readers minus the analyst and the academic assistant.
 * Mirrors GRADE_WRITE_ROLES in apps/api.
 */
export function canEditGrades(staff: StaffAccess): boolean {
  return has(staff, 'grades.record')
}

/**
 * Moving students on to the next module from the backoffice (OOC-156, to
 * confirm with the owner): management and both supervisions — the same list
 * as `PROGRESSION_ROLES` in `apps/api`. The teacher does it from the portal.
 */
/**
 * Who reads a class group's certificate batch (OOC-33): coordination, and the
 * `analyst`, who reads and never acts. Mirrors `CERTIFICATE_READ_ROLES` in
 * `apps/api`, which decides.
 */
export function canReadCertificates(staff: StaffAccess): boolean {
  return has(staff, 'grades.certificates_preview')
}

/** Who confirms the batch (OOC-33): mirrors `CERTIFICATE_ISSUE_ROLES`. */
export function canIssueCertificates(staff: StaffAccess): boolean {
  return has(staff, 'grades.certificates_issue')
}

export function canMoveStudentsOn(staff: StaffAccess): boolean {
  return has(staff, 'grades.progression')
}

/**
 * Who downloads a recorded contract — the roster's readers, analyst included;
 * the teacher does not, even on their own file. Mirrors `TEACHER_READ_ROLES`
 * on `GET /teachers/:id/contracts/:id/document` (generated, OOC-124) and
 * `…/file` (filed, OOC-81). Generating one records it, so it is an edit:
 * `canEditTeachers`.
 */
export function canOpenTeacherContracts(staff: StaffAccess): boolean {
  return has(staff, 'teachers.contract_download')
}

/**
 * Who registers a new teacher. Management only: a teacher record is an account
 * that will read student grades, and creating one is one step away from
 * creating staff — which `CLAUDE.md` §8 puts behind a dedicated usecase.
 */
export function canCreateTeacher(staff: StaffAccess): boolean {
  return has(staff, 'teachers.register')
}

/**
 * Who may browse the whole student directory. Billing settles money and has
 * no business in the directory. A teacher never reaches the backoffice — they
 * read the names of their own class groups in the docente portal — and stays
 * refused here all the same, so a matrix read outside the shell cannot say yes.
 */
export function canBrowseStudents(staff: StaffAccess): boolean {
  return has(staff, 'students.view')
}

/**
 * Who registers a student by hand. The documented way in is the student filling
 * `/enrollment` themselves (CLAUDE.md §1); this covers the person who closed
 * the sale on WhatsApp and never reached the form. A registration carries the
 * guardian record and the consent behind it (Ley 29733, CLAUDE.md §8), so it
 * stays with management and the enrollment side.
 */
export function canCreateStudent(staff: StaffAccess): boolean {
  return has(staff, 'students.edit')
}

/**
 * Who corrects a student file — the student's data and the guardian's. The
 * same three as registration (decision of 07/10/2026, OOC-74): `support` does
 * not correct contact either. The enforcing check is `STUDENT_FILE_ROLES` on
 * the routes in `apps/api`.
 */
export function canEditStudent(staff: StaffAccess): boolean {
  return has(staff, 'students.edit')
}

/**
 * Who lists, attaches, downloads and removes a student's files (OOC-143): the
 * same three who keep the file — a scanned DNI is not for every reader of the
 * directory. Mirrors `ATTACHMENT_STAFF_POLICY` in `apps/api`, which decides.
 */
export function canManageStudentAttachments(staff: StaffAccess): boolean {
  return has(staff, 'students.edit')
}

/**
 * Who revokes a document the institution issued (OOC-59 — proposal, to confirm
 * with the owner): the same three who keep the file, from its document list.
 * Mirrors `ISSUED_DOCUMENT_REVOKE_ROLES` in `apps/api`, which decides.
 */
export function canRevokeIssuedDocuments(staff: StaffAccess): boolean {
  return has(staff, 'students.revoke_document')
}

/**
 * Who takes the directory away as a CSV (OOC-121): the same three who keep the
 * file, so nobody exports a document or contact the ficha would not show them.
 * `sales` and `support` answer for one student at a time; the whole base does
 * not leave with them. The enforcing check is `STUDENT_EXPORT_ROLES` on the
 * route in `apps/api`.
 */
export function canExportStudents(staff: StaffAccess): boolean {
  return has(staff, 'students.export')
}

/**
 * Who reads the general audit log (OOC-122): management, and the analyst, who
 * observes every area without editing any. The log names students, payments
 * and staff across the platform, so a cargo that works one area does not read
 * it. The enforcing check is `AUDIT_LOG_ROLES` on the routes in `apps/api`.
 */
export function canViewAuditLog(staff: StaffAccess): boolean {
  return has(staff, 'reports.audit_log')
}

/**
 * Who sends a student their portal access from the file — the same audience
 * as the file itself (`GetStudentRoute`) and the API route behind the button
 * (`IssuePortalAccessRoute`). Billing settles money; it does not hand out
 * accounts.
 */
export function canIssuePortalAccess(staff: StaffAccess): boolean {
  return has(staff, 'students.portal_access')
}

/**
 * Who may read the enrollment ledger. The enrollment side owns it, the
 * academic supervisor reads the class groups it feeds, the analyst observes,
 * and sales and support answer for the enrollments people ask them about.
 * Billing settles money in the payments section; a teacher sees their own
 * class groups, one at a time (CLAUDE.md §8).
 */
export function canBrowseEnrollments(staff: StaffAccess): boolean {
  return has(staff, 'enrollments.view')
}

/**
 * Who reads the catalog (courses, plans, class groups, the teachers' week) —
 * mirrors CATALOG_READ_ROLES in apps/api. The ledger's readers, plus the
 * academic assistant (OOC-96), who needs the class groups and the teacher
 * calendar to run the roster but not the enrollment ledger. Billing sees no
 * academic data; a teacher reaches their own class groups through their own
 * screen.
 */
export function canBrowseCatalog(staff: StaffAccess): boolean {
  return has(staff, 'catalog.view')
}

/** Who opens a plan or puts a new price in force — money, so management only. */
export function canManagePrices(staff: StaffAccess): boolean {
  return has(staff, 'catalog.plan_prices')
}

/**
 * Who may read the reports — the ledger summed up. Management, the two
 * supervisors and the analyst; billing's own figure — what came in this ciclo —
 * is on the payments section, next to the receipts it settles.
 */
export function canBrowseReports(staff: StaffAccess): boolean {
  return has(staff, 'reports.view')
}

/**
 * Who may open an enrollment from the panel. The documented way in is the
 * student filling `/enrollment` themselves (CLAUDE.md §1); this is the
 * exception for the sale that closed on WhatsApp and never reached the form.
 */
export function canCreateEnrollment(staff: StaffAccess): boolean {
  return has(staff, 'enrollments.create_manual')
}

/**
 * Who opens the team directory — the panel's own accounts and their cargos.
 * Management only: it is the surface where a cargo changes, and the
 * anti-escalation rule keeps that with the top of the house (CLAUDE.md §8).
 */
export function canManageStaff(staff: StaffAccess): boolean {
  return has(staff, 'team.view')
}

/**
 * Who reads the role matrix (OOC-57) — what each cargo can do. Management, and
 * the analyst, who observes every area without editing any; the matrix is a
 * description of the platform's doors, with no personal data in it. The
 * enforcing check is `PERMISSION_MATRIX_ROLES` on the route in `apps/api`.
 */
export function canViewPermissionMatrix(staff: StaffAccess): boolean {
  return has(staff, 'team.permissions')
}

/**
 * Who opens the e-mail module. The catalog decides what every student receives
 * at the moment their enrollment moves, so it belongs to management and the
 * enrollment side; the analyst reads it.
 */
export function canManageEmail(staff: StaffAccess): boolean {
  return has(staff, 'emails.view')
}

/**
 * Who resends an e-mail that failed (OOC-90): the e-mail section's cargos
 * minus the analyst, who observes and never edits (CLAUDE.md §8). The API
 * enforces the same list (`EMAIL_DELIVERY_RESEND_ROLES`).
 */
export function canResendEmail(staff: StaffAccess): boolean {
  return has(staff, 'emails.send')
}

/**
 * Who sends a proof of an automatic e-mail (OOC-89): the same cargos as the
 * resend — a proof is a real e-mail leaving the platform. The API enforces the
 * same list (`EMAIL_PROOF_ROLES`).
 */
export function canSendEmailProof(staff: StaffAccess): boolean {
  return has(staff, 'emails.send')
}

/**
 * Who opens the platform settings. Management only: that screen holds the grade
 * that decides who is certified and the tolerance the platform approves a
 * receipt with when nobody is looking.
 */
export function canConfigureSettings(staff: StaffAccess): boolean {
  return has(staff, 'settings.edit')
}


/**
 * Who edits a course's own data — name, language, level, summary (OOC-183
 * split it from opening a course). The enforcing check is
 * `catalog.courses_edit` on `PATCH /catalog/courses/:id`.
 */
export function canEditCourseIdentity(staff: StaffAccess): boolean {
  return has(staff, 'catalog.courses_edit')
}

/** Move, freeze and transfer an enrollment — three permissions, one dialog each. */
export function canFreezeEnrollment(staff: StaffAccess): boolean {
  return has(staff, 'enrollments.freeze')
}

export function canTransferEnrollment(staff: StaffAccess): boolean {
  return has(staff, 'enrollments.transfer')
}

/** Team actions (OOC-183): each its own permission, enforced on its route. */
export function canInviteStaff(staff: StaffAccess): boolean {
  return has(staff, 'team.invite')
}

export function canChangeStaffRole(staff: StaffAccess): boolean {
  return has(staff, 'team.change_role')
}

export function canManageStaffAccess(staff: StaffAccess): boolean {
  return has(staff, 'team.access')
}

export function canRetireStaffAccount(staff: StaffAccess): boolean {
  return has(staff, 'team.retire')
}

/** Who creates, edits and retires cargos — and only within what they hold, which the API checks. */
export function canManageProfiles(staff: StaffAccess): boolean {
  return has(staff, 'team.profiles')
}
