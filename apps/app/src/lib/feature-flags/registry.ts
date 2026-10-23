/**
 * The one place a feature flag is declared.
 *
 * A flag answers a single question: does this piece of the platform exist in
 * production, or is it still ours alone? Off does not mean "gone" — it means
 * the screen is served to nobody but us, and reaching it in production takes
 * the internal unlock (`preview.ts`). Local and Vercel preview deploys are our
 * ground: every flag is on there, always, so a branch never demos half a panel.
 *
 * Two rules keep this honest:
 *
 * 1. A new section is born `production: false`. Whoever ships it flips the flag
 *    the day the section is real, in the same PR that makes it real — nothing
 *    reaches a student because someone forgot a file existed.
 * 2. The flag is not the access control. What a person may *do* is the role
 *    check declared on the route in `apps/api` (CLAUDE.md §8). A flag decides
 *    whether the feature is on the air at all; the role decides who it answers.
 */

/** The three surfaces the panel is managed by. */
export type FeatureSurface = 'portal' | 'backoffice' | 'teacher'

interface FeatureFlagSpec {
  surface: FeatureSurface
  /**
   * Parent flag. A child is only ever as on as its parent: turning the portal
   * off takes its sections with it, whatever each one declares. Checked at boot
   * against the keys below (`assertRegistry`).
   */
  parent?: string
  /**
   * Whether the feature is served in production. Everywhere else — local, the
   * preview deploys — every flag is on regardless of what this says.
   *
   * Everything is `true` today because everything below is already in the air:
   * this registry arrives to *manage* what is exposed, not to retire screens
   * behind our backs. Flipping any of these to `false` is a decision, and it is
   * one line.
   */
  production: boolean
}

export const FEATURE_FLAGS = {
  /* ---------------------------------------------------------------- portal */

  /** The student portal as a whole — the shell, the dashboard, the account. */
  portal: { surface: 'portal', production: true },

  'portal.courses': {
    surface: 'portal',
    parent: 'portal',
    production: true,
  },
  'portal.payments': {
    surface: 'portal',
    parent: 'portal',
    production: true,
  },
  /** Trámites: constancia, certificación, rezagados, congelamiento. */
  'portal.procedures': {
    surface: 'portal',
    parent: 'portal',
    production: true,
  },
  'portal.documents': {
    surface: 'portal',
    parent: 'portal',
    production: true,
  },
  /** Continuar estudando — next level and re-enrollment from inside. */
  'portal.continue': {
    surface: 'portal',
    parent: 'portal',
    production: true,
  },

  /* ------------------------------------------------------------ backoffice */

  /** The staff panel as a whole — the shell and its dashboard. */
  backoffice: { surface: 'backoffice', production: true },

  'backoffice.students': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.enrollments': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.payments': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  /** Class groups and courses — one section, read together. */
  'backoffice.academic': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.teachers': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.email': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.reports': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  /** The team directory — where a cargo changes. */
  'backoffice.staff': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },
  'backoffice.settings': {
    surface: 'backoffice',
    parent: 'backoffice',
    production: true,
  },

  /* --------------------------------------------------------------- docente */

  /**
   * The docente portal (`/docente`): its own login and shell, same app and
   * same auth as the backoffice — which is why it still hangs off
   * `backoffice`. Off, `/docente` (login included) answers 404; every other
   * cargo is untouched.
   */
  teacher: { surface: 'teacher', parent: 'backoffice', production: true },

  /**
   * Agenda: the teacher's classes on a calendar, week and month, derived
   * from their class groups. Off in production until the class groups behind
   * it come from the API rather than the mock.
   */
  'teacher.agenda': {
    surface: 'teacher',
    parent: 'teacher',
    production: false,
  },

} as const satisfies Record<string, FeatureFlagSpec>

/*
 * Funcionalidades — the panel screen that moves these switches — has no flag
 * of its own, and that is deliberate. A flag over the switchboard is the one
 * flag nobody could recover from the screen it hides: turning it off in
 * production would leave the env var as the only way back, which is exactly
 * the situation the screen exists to end. It is kept off the air by other
 * means instead — it is drawn only for the owners' e-mail domain, and the
 * routes behind it are `.owners()` in `apps/api`.
 */

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]

/**
 * Environment variable that overrides a flag: `portal.payments` is driven by
 * `OOC_FLAG_PORTAL_PAYMENTS`. On Vercel each one is scoped per environment,
 * which is what lets production be turned on without a code change — and a
 * preview deploy be turned off, when a branch needs to demo the off state.
 */
export function flagEnvVar(key: FeatureFlagKey): string {
  return `OOC_FLAG_${key.replace(/\./g, '_').toUpperCase()}`
}

/** Boot check: a parent that names nothing is a flag that never turns off. */
export function assertRegistry(): void {
  for (const key of FEATURE_FLAG_KEYS) {
    const parent = (FEATURE_FLAGS[key] as FeatureFlagSpec).parent
    if (parent !== undefined && !(parent in FEATURE_FLAGS)) {
      throw new Error(
        `Feature flag "${key}" declares an unknown parent "${parent}".`,
      )
    }
  }
}
