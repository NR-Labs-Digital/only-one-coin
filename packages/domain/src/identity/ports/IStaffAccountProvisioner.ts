import type { Role } from "../Role.js";

export interface ProvisionStaffAccountInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  /** The cargo created in Equipo, for a `custom` account (OOC-183). */
  profileId: string | null;
}

export interface ProvisionStaffAccountOutput {
  userId: string;
}

/**
 * Turns a completed invite into a real account. The account is written
 * directly (user plus credential, with `role`) — Better Auth's own sign-up is
 * closed, server calls included, and `role` is `input:false` towards clients
 * (CLAUDE.md §8).
 */
export interface IStaffAccountProvisioner {
  provision(input: ProvisionStaffAccountInput): Promise<ProvisionStaffAccountOutput>;
}
