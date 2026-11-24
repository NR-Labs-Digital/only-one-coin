import {
  BOARD_ROLES,
  EVERYONE_PERMISSIONS,
  LOCKED_ROLES,
  defaultPermissionsOf,
  grantOf,
  holdsMfaSensitive,
  isGrantable,
  isPermissionKey,
  type BoardRole,
  type PermissionKey,
} from "../permissionCatalog.js";
import { MFA_REQUIRED_ROLES, type Role } from "../Role.js";
import {
  StaffProfileBeyondOwnPermissionsError,
  StaffProfileNameInvalidError,
  StaffProfilePermissionNotGrantableError,
} from "./errors.js";

/** A cargo as stored: a board one (`role`) or one created in Equipo (`name`). */
export interface StaffProfileRecord {
  id: string;
  role: BoardRole | null;
  name: string | null;
  /** As stored. A locked cargo's real set comes from the code — see `profilePermissions`. */
  permissions: PermissionKey[];
}

/** Who an account is, as far as its cargo goes. */
export interface StaffAssignment {
  role: Role;
  profileId?: string | null;
}

export function isBoardRole(role: string): role is BoardRole {
  return (BOARD_ROLES as readonly string[]).includes(role);
}

export function isLockedRole(role: BoardRole | null): boolean {
  return role !== null && (LOCKED_ROLES as readonly string[]).includes(role);
}

/**
 * What a cargo can really do. Master and teacher are never edited, so theirs
 * is the code's; every cargo also holds what every account holds (its own
 * password, language and second factor).
 */
export function profilePermissions(profile: Pick<StaffProfileRecord, "role" | "permissions">): Set<PermissionKey> {
  const base = profile.role && isLockedRole(profile.role) ? defaultPermissionsOf(profile.role) : profile.permissions;
  return new Set<PermissionKey>([...base, ...EVERYONE_PERMISSIONS]);
}

/**
 * Whether accounts on a cargo must sign in with the second factor: the board's
 * three that always have (CLAUDE.md §8), and any cargo holding a permission
 * that moves money, hands out access or changes the platform's rules.
 */
export function profileRequiresMfa(profile: Pick<StaffProfileRecord, "role" | "permissions">): boolean {
  if (profile.role && (MFA_REQUIRED_ROLES as readonly string[]).includes(profile.role)) return true;
  return holdsMfaSensitive(profilePermissions(profile));
}

/** A cargo's name as typed: trimmed, inner spaces collapsed, 2 to 60 characters. */
export function normalizeProfileName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new StaffProfileNameInvalidError();
  return name;
}

/**
 * The permissions a screen asked for, refused unless each is known and handed
 * out by cargos. What every account holds anyway (its own settings) is
 * dropped, not refused: a screen may send back the whole set it was shown.
 */
export function grantablePermissions(requested: readonly string[]): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const key of new Set(requested)) {
    if (!isPermissionKey(key)) throw new StaffProfilePermissionNotGrantableError();
    if (grantOf(key) === "everyone") continue;
    if (!isGrantable(key)) throw new StaffProfilePermissionNotGrantableError();
    keys.push(key);
  }
  return keys;
}

/**
 * Nobody hands out what they do not hold (CLAUDE.md §8, anti-escalation):
 * every permission in `wanted` must be one the actor holds.
 */
export function assertWithinActor(actorPermissions: ReadonlySet<string>, wanted: Iterable<string>): void {
  for (const key of wanted) {
    if (!actorPermissions.has(key)) throw new StaffProfileBeyondOwnPermissionsError();
  }
}
