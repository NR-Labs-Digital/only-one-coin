// Quadro de cargos do dono (07/09/2026) — união fechada, nunca string livre.
// `master` é o cargo dos donos da plataforma: só contas no domínio deles podem
// carregá-lo (checado na rota de convite via `canHoldMaster`).
export type Role =
  | "master"
  | "admin"
  | "analyst"
  | "enrollment_supervisor"
  | "academic_supervisor"
  | "teacher"
  | "sales"
  | "support"
  | "billing"
  | "student"
  | "guardian";

/**
 * The platform owners' e-mail domains — the only accounts allowed to hold
 * `master`. Two domains as of 17/09/2026: `admin.com` joined
 * `nrlabsdigital.com` because the account actually used as the team's
 * production login carries it — see `CLAUDE.md` §8 for the decision.
 */
export const MASTER_EMAIL_DOMAINS = ["nrlabsdigital.com", "admin.com"] as const;

/**
 * Whether this e-mail belongs to the platform owners.
 *
 * The domain answers two different questions and they are worth naming apart:
 * which accounts may carry the `master` cargo (`canHoldMaster`), and which
 * accounts may reach what belongs to whoever runs the platform rather than to
 * whoever runs the school — today, the feature-flag switchboard (CLAUDE.md §5).
 * The second one deliberately ignores the cargo: an `admin` of the Asociación
 * is not an owner, and an owner is one whatever cargo their account carries.
 */
export function isOwnerEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return MASTER_EMAIL_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`));
}

/** Whether this e-mail may carry the `master` cargo. */
export function canHoldMaster(email: string): boolean {
  return isOwnerEmail(email);
}
