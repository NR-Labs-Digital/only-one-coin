import { defaultPermissionsOf, isGrantable, type PermissionKey } from "../permissionCatalog.js";
import type { IStaffProfileRepository } from "./IStaffProfileRepository.js";
import { isBoardRole, profilePermissions, type StaffAssignment } from "./StaffProfile.js";
import { StaffProfileNotFoundError } from "./errors.js";

/**
 * What an account on this cargo can do, read the way the authorization hook
 * reads it. A board cargo missing its row (a database the API has not booted
 * against yet) falls back to the board's defaults; a retired one is refused,
 * like a retired created cargo — nobody is put on it again.
 */
export async function cargoPermissions(
  profiles: IStaffProfileRepository,
  assignment: StaffAssignment,
): Promise<Set<PermissionKey>> {
  if (assignment.role === "custom") {
    const profile = assignment.profileId ? await profiles.findLiveById(assignment.profileId) : null;
    if (!profile) throw new StaffProfileNotFoundError();
    return profilePermissions(profile);
  }
  if (!isBoardRole(assignment.role)) return new Set();
  const profile = await profiles.findByRole(assignment.role);
  if (profile?.retired) throw new StaffProfileNotFoundError();
  return profilePermissions(profile ?? { role: assignment.role, permissions: defaultPermissionsOf(assignment.role) });
}

/**
 * The part of a cargo the anti-escalation rule compares: what a cargo can be
 * handed. The teacher portal, the owners' door and an account's own settings
 * are no cargo's to give, so an admin — who holds none of the teacher's —
 * still invites a teacher.
 */
export function comparablePermissions(permissions: Iterable<PermissionKey>): PermissionKey[] {
  return [...permissions].filter((key) => isGrantable(key));
}
