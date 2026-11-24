import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../ports/IAuditLogRepository.js";
import type { PermissionKey } from "../permissionCatalog.js";
import type { IStaffProfileRepository } from "./IStaffProfileRepository.js";
import {
  assertWithinActor,
  grantablePermissions,
  isLockedRole,
  normalizeProfileName,
  profilePermissions,
  type StaffAssignment,
  type StaffProfileRecord,
} from "./StaffProfile.js";
import { comparablePermissions } from "./cargoPermissions.js";
import {
  StaffProfileInUseError,
  StaffProfileLockedError,
  StaffProfileNameTakenError,
  StaffProfileNotFoundError,
  StaffProfileOwnError,
} from "./errors.js";

/** Who is acting, and what their own cargo lets them do. */
export interface StaffProfileActor {
  userId: string;
  assignment: StaffAssignment;
  permissions: ReadonlySet<string>;
}

/** Whether the actor is on this very cargo. */
function isOwnCargo(actor: StaffProfileActor, profile: StaffProfileRecord): boolean {
  return actor.assignment.role === "custom"
    ? actor.assignment.profileId === profile.id
    : profile.role === actor.assignment.role;
}

/**
 * The cargo an edit or a retirement may touch: live, not locked, not the
 * actor's own, and no stronger than the actor — someone who could not have
 * created it may not reshape it either.
 */
async function editableProfile(
  profiles: IStaffProfileRepository,
  actor: StaffProfileActor,
  id: string,
): Promise<StaffProfileRecord> {
  const profile = await profiles.findLiveById(id);
  if (!profile) throw new StaffProfileNotFoundError();
  if (isLockedRole(profile.role)) throw new StaffProfileLockedError();
  if (isOwnCargo(actor, profile)) throw new StaffProfileOwnError();
  assertWithinActor(actor.permissions, comparablePermissions(profilePermissions(profile)));
  return profile;
}

export interface CreateStaffProfileInput {
  actor: StaffProfileActor;
  name: string;
  permissions: string[];
}

/** A new cargo, named by administration and holding only what the actor holds (OOC-183). */
export class CreateStaffProfileUseCase extends BaseUseCase<CreateStaffProfileInput, StaffProfileRecord> {
  constructor(
    private readonly profiles: IStaffProfileRepository,
    private readonly audit: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateStaffProfileInput): Promise<StaffProfileRecord> {
    const name = normalizeProfileName(input.name);
    const permissions = grantablePermissions(input.permissions);
    assertWithinActor(input.actor.permissions, permissions);
    if (await this.profiles.nameTaken(name)) throw new StaffProfileNameTakenError();

    const profile = await this.profiles.create({ name, permissions, createdBy: input.actor.userId });

    await this.audit.append({
      actorId: input.actor.userId,
      action: "staff_profile.created",
      targetId: profile.id,
      metadata: { permissions: [...permissions].sort() },
      at: new Date(),
    });
    return profile;
  }
}

export interface UpdateStaffProfileInput {
  actor: StaffProfileActor;
  profileId: string;
  /** Only a cargo created in Equipo has a name; a board cargo's comes from the locale. */
  name?: string;
  permissions: string[];
}

export interface UpdateStaffProfileOutput {
  added: PermissionKey[];
  removed: PermissionKey[];
}

/**
 * Edits what a cargo can do — the board's (but master and teacher) and the
 * ones created in Equipo. The accounts on it feel it on their next request.
 * The trail keeps the permission keys added and removed: they name doors of
 * the platform, not people.
 */
export class UpdateStaffProfileUseCase extends BaseUseCase<UpdateStaffProfileInput, UpdateStaffProfileOutput> {
  constructor(
    private readonly profiles: IStaffProfileRepository,
    private readonly audit: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateStaffProfileInput): Promise<UpdateStaffProfileOutput> {
    const profile = await editableProfile(this.profiles, input.actor, input.profileId);
    const permissions = grantablePermissions(input.permissions);
    assertWithinActor(input.actor.permissions, permissions);

    let name: string | undefined;
    if (input.name !== undefined && profile.name !== null) {
      name = normalizeProfileName(input.name);
      if (name === profile.name) name = undefined;
      else if (await this.profiles.nameTaken(name, profile.id)) throw new StaffProfileNameTakenError();
    }

    const before = new Set(profile.permissions);
    const after = new Set(permissions);
    const added = permissions.filter((key) => !before.has(key)).sort();
    const removed = profile.permissions.filter((key) => !after.has(key)).sort();
    if (added.length === 0 && removed.length === 0 && name === undefined) return { added, removed };

    await this.profiles.update(profile.id, { name, permissions });

    await this.audit.append({
      actorId: input.actor.userId,
      action: "staff_profile.updated",
      targetId: profile.id,
      metadata: {
        ...(profile.role ? { role: profile.role } : {}),
        ...(name !== undefined ? { fields: ["name"] } : {}),
        added,
        removed,
      },
      at: new Date(),
    });
    return { added, removed };
  }
}

export interface RetireStaffProfileInput {
  actor: StaffProfileActor;
  profileId: string;
}

/**
 * Retires a cargo created in Equipo once nobody is on it — no account and no
 * invite waiting on the person. A board cargo never retires.
 */
export class RetireStaffProfileUseCase extends BaseUseCase<RetireStaffProfileInput, void> {
  constructor(
    private readonly profiles: IStaffProfileRepository,
    private readonly audit: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireStaffProfileInput): Promise<void> {
    const profile = await editableProfile(this.profiles, input.actor, input.profileId);
    if (profile.role !== null) throw new StaffProfileLockedError();
    if ((await this.profiles.countMembers(profile.id)) > 0) throw new StaffProfileInUseError();

    await this.profiles.retire(profile.id);

    await this.audit.append({
      actorId: input.actor.userId,
      action: "staff_profile.retired",
      targetId: profile.id,
      metadata: {},
      at: new Date(),
    });
  }
}
