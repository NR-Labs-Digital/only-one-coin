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
  /**
   * A board cargo's row, retired or not: a retired board cargo is one nobody
   * may be put on again, which is not the same as a row the boot has not
   * written yet (null).
   */
  findByRole(role: BoardRole): Promise<(StaffProfileRecord & { retired: boolean }) | null>;
  /** Whether another live cargo is named this, compared without case. */
  nameTaken(name: string, exceptId?: string): Promise<boolean>;
  create(input: { name: string; permissions: PermissionKey[]; createdBy: string }): Promise<StaffProfileRecord>;
  update(id: string, input: { name?: string; permissions: PermissionKey[] }): Promise<void>;
  retire(id: string): Promise<void>;
  /**
   * Live accounts and pending invites on the cargo: a board cargo's carry its
   * `role`, a created cargo's point at it by `profile_id`.
   */
  countMembers(profile: Pick<StaffProfileRecord, "id" | "role">): Promise<number>;
}
