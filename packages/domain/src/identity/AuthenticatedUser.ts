import type { Role } from "./Role.js";

export interface AuthenticatedUser {
  id: string;
  role: Role;
  email: string;
  name: string;
  /**
   * Whether the account has the second factor turned on — once it is, no
   * session exists without the e-mail code (or a recovery code) having been
   * verified. A cargo in `MFA_REQUIRED_ROLES` without it is refused by the
   * authorization hook (CLAUDE.md §8).
   */
  twoFactorEnabled: boolean;
}
