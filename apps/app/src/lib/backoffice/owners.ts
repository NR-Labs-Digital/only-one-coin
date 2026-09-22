/**
 * The two gates that read an e-mail instead of a cargo, kept in their own
 * module so a client component can ask them without dragging the permission
 * matrix (`role-permissions.ts`, a server-side store) into the browser bundle.
 *
 * `permissions.ts` re-exports both: every server call site keeps its import.
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
 * The only gate here that reads an e-mail instead of a cargo, and deliberately
 * so: what exists is a decision of whoever runs the platform, not of whoever
 * runs the school. An `admin` of the Asociación authorizes everything academic
 * and none of this; an owner opens it whatever cargo their account carries. As
 * everywhere else, this only draws the screen — the check that counts is
 * `.owners()` on the route in `apps/api`.
 */
export function canManageFeatureFlags(email: string): boolean {
  return isOwnerEmail(email)
}
