import type { StaffRole } from './types'

/**
 * The catalog of what a cargo can be given.
 *
 * Until now each of these lived as a hand-written `canX(role)` in
 * `permissions.ts`: the list of cargos was typed into the function body, so
 * giving `sales` the right to register a student was a commit, a review and a
 * deploy. The catalog stays in code — a permission is a door that exists
 * because a screen exists, and inventing one from a screen would be inventing
 * a screen — but *who holds it* moves to the panel (`/backoffice/team/permissions`),
 * the same split Funcionalidades made between the registry and the switchboard
 * (CLAUDE.md §5).
 *
 * Two things this is not:
 *
 * 1. **It is not the access control.** What a person may actually do is the
 *    role declared on the route in `apps/api`, deny-by-default (CLAUDE.md §8).
 *    This decides which doors the panel draws — defense in depth, never the
 *    defense. Widening a cargo here without the API agreeing gets a 403 at the
 *    door, which is the failure mode we want.
 * 2. **It is not scope.** A docente sees their own class groups and nobody
 *    else's; that comparison is `teacher_id` inside the usecase and no switch
 *    on any screen relaxes it. So `isRestrictedToOwnClassGroups` and
 *    `canRecordGrades` are deliberately absent from this catalog.
 */

/** Where a capability shows up in the panel — how the screen groups them. */
export type CapabilityGroup = 'operations' | 'academic' | 'administration'

export type CapabilityKey =
  | 'students_browse'
  | 'students_create'
  | 'enrollments_browse'
  | 'enrollments_create'
  | 'enrollments_manage'
  | 'payments_view'
  | 'payments_review'
  | 'courses_create'
  | 'courses_configure'
  | 'class_groups_create'
  | 'certificates_issue'
  | 'teachers_manage'
  | 'teachers_create'
  | 'email_manage'
  | 'reports_browse'
  | 'settings_configure'
  | 'team_manage'

export interface CapabilitySpec {
  group: CapabilityGroup
  /**
   * Who holds it when nobody has touched the panel — the owner's cargo map of
   * 07/09/2026, exactly as `permissions.ts` used to spell it out one function
   * at a time.
   */
  defaultRoles: readonly StaffRole[]
  /**
   * A capability that is meaningless without another one. Granting a
   * dependent grants its requirement; revoking a requirement revokes whatever
   * hangs off it. A cargo allowed to register a student but not to open the
   * directory would be handed a form it can never reach.
   */
  requires?: CapabilityKey
  /**
   * Fixed for every cargo, panel or no panel. Only the team directory carries
   * it: that is the surface where a cargo changes — and where this very screen
   * lives — so letting it be handed out would let any cargo hand itself
   * everything else. The anti-escalation rule keeps it with the top of the
   * house (CLAUDE.md §8).
   */
  locked?: true
}

/**
 * The cargos that always hold everything, whatever the panel says.
 *
 * `master` is the platform owners' cargo and `admin` is who authorizes inside
 * the school (CLAUDE.md §8) — a screen that can take `admin` off the payment
 * queue is a screen that can lock the house from the inside. They are drawn on
 * the matrix, always on, never editable.
 */
export const ALWAYS_ALLOWED_ROLES: readonly StaffRole[] = ['master', 'admin']

/** The cargos the matrix actually lets somebody move. */
export const CONFIGURABLE_ROLES: readonly StaffRole[] = [
  'analyst',
  'enrollment_supervisor',
  'academic_supervisor',
  'teacher',
  'sales',
  'support',
  'billing',
]

/** Every cargo the matrix draws, management first. */
export const MATRIX_ROLES: readonly StaffRole[] = [
  ...ALWAYS_ALLOWED_ROLES,
  ...CONFIGURABLE_ROLES,
]

export const CAPABILITIES: Record<CapabilityKey, CapabilitySpec> = {
  /* ------------------------------------------------------------ operations */

  /** Browse the whole student directory. */
  students_browse: {
    group: 'operations',
    defaultRoles: [
      'master',
      'admin',
      'analyst',
      'enrollment_supervisor',
      'academic_supervisor',
      'sales',
      'support',
    ],
  },
  /**
   * Register a student by hand. Carries the guardian record and the consent
   * behind it (Ley 29733, CLAUDE.md §8) — which is why it was management's
   * alone until somebody decided otherwise here.
   */
  students_create: {
    group: 'operations',
    defaultRoles: ['master', 'admin', 'enrollment_supervisor'],
    requires: 'students_browse',
  },
  /** Read the enrollment ledger. */
  enrollments_browse: {
    group: 'operations',
    defaultRoles: [
      'master',
      'admin',
      'analyst',
      'enrollment_supervisor',
      'academic_supervisor',
      'sales',
      'support',
    ],
  },
  /**
   * Open an enrollment from the panel — the exception for the sale that closed
   * on WhatsApp and never reached `/enrollment` (CLAUDE.md §1). It never
   * settles the money: the receipt still climbs the same OCR ladder.
   */
  enrollments_create: {
    group: 'operations',
    defaultRoles: ['master', 'admin', 'enrollment_supervisor'],
    requires: 'enrollments_browse',
  },
  /** Record a procedure over an enrollment — moving, freezing, withdrawing. */
  enrollments_manage: {
    group: 'operations',
    defaultRoles: ['master', 'admin', 'enrollment_supervisor'],
    requires: 'enrollments_browse',
  },
  /** Open the payments section at all. */
  payments_view: {
    group: 'operations',
    defaultRoles: ['master', 'admin', 'analyst', 'billing', 'support'],
  },
  /** Settle a receipt the ladder could not — approve or reject by hand. */
  payments_review: {
    group: 'operations',
    defaultRoles: ['master', 'admin', 'billing'],
    requires: 'payments_view',
  },

  /* -------------------------------------------------------------- academic */

  /** Open a course — what the catalog and the price table hang off. */
  courses_create: {
    group: 'academic',
    defaultRoles: ['master', 'admin'],
  },
  /** Change a course's options — not the same as opening one. */
  courses_configure: {
    group: 'academic',
    defaultRoles: ['master', 'admin', 'enrollment_supervisor'],
  },
  /** Open a class group: dates, schedule, capacity, teacher. */
  class_groups_create: {
    group: 'academic',
    defaultRoles: [
      'master',
      'admin',
      'enrollment_supervisor',
      'academic_supervisor',
    ],
  },
  /**
   * Issue a document or fire a class group's batch. A teacher holds it for
   * their own class groups only — the scope check is in the usecase, and no
   * switch here touches it.
   */
  certificates_issue: {
    group: 'academic',
    defaultRoles: [
      'master',
      'admin',
      'enrollment_supervisor',
      'academic_supervisor',
      'teacher',
    ],
  },
  /** Open the teacher roster. */
  teachers_manage: {
    group: 'academic',
    defaultRoles: ['master', 'admin', 'academic_supervisor', 'analyst'],
  },
  /**
   * Register a teacher. A teacher record is an account that will read student
   * grades, so it sits one step from creating staff.
   */
  teachers_create: {
    group: 'academic',
    defaultRoles: ['master', 'admin'],
    requires: 'teachers_manage',
  },

  /* -------------------------------------------------------- administration */

  /** Open the e-mail module — the catalog of what every student receives. */
  email_manage: {
    group: 'administration',
    defaultRoles: ['master', 'admin', 'enrollment_supervisor', 'analyst'],
  },
  /** Read the reports — the ledger summed up. */
  reports_browse: {
    group: 'administration',
    defaultRoles: [
      'master',
      'admin',
      'analyst',
      'enrollment_supervisor',
      'academic_supervisor',
    ],
  },
  /**
   * Open the platform settings — the passing grade and the tolerance a receipt
   * is approved with when nobody is looking.
   */
  settings_configure: {
    group: 'administration',
    defaultRoles: ['master', 'admin'],
  },
  /**
   * Open the team directory, and with it this matrix. Locked on purpose: see
   * `locked` above.
   */
  team_manage: {
    group: 'administration',
    defaultRoles: ['master', 'admin'],
    locked: true,
  },
}

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[]

/** Every capability that names `key` as its requirement. */
export function dependentsOf(key: CapabilityKey): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((other) => CAPABILITIES[other].requires === key)
}
