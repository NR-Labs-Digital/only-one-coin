import type { BoardRole, PermissionKey } from "../permissionCatalog.js";
import type { StaffProfileRecord } from "./StaffProfile.js";

export interface StaffProfileListing extends StaffProfileRecord {
  /** Live accounts on the cargo plus invites still waiting on the person. */
  members: number;
}

/**
 * The cargos (OOC-183). Writes replace a cargo's permissions whole; the
 * caller is the usecase, which has already applied the anti-escalation rules.
 */
export interface IStaffProfileRepository {
  listLive(): Promise<StaffProfileListing[]>;
  findLiveById(id: string): Promise<StaffProfileRecord | null>;
  findByRole(role: BoardRole): Promise<StaffProfileRecord | null>;
  /** Whether another live cargo is named this, compared without case. */
  nameTaken(name: string, exceptId?: string): Promise<boolean>;
  create(input: { name: string; permissions: PermissionKey[]; createdBy: string }): Promise<StaffProfileRecord>;
  update(id: string, input: { name?: string; permissions: PermissionKey[] }): Promise<void>;
  retire(id: string): Promise<void>;
  countMembers(id: string): Promise<number>;
}
