import { ConflictError } from "../../shared/base/errors/ConflictError.js";
import { ForbiddenError } from "../../shared/base/errors/ForbiddenError.js";
import { NotFoundError } from "../../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";

export class StaffProfileNotFoundError extends NotFoundError {
  constructor() {
    super({ reason: "staff_profile.not_found", message: "No live cargo with this id." });
  }
}

/** Master and teacher are never edited on the screen (OOC-183). */
export class StaffProfileLockedError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "staff_profile.locked", message: "This cargo is not edited on the screen." });
  }
}

/** Nobody edits the cargo they themselves are on — the same rule as changing one's own cargo. */
export class StaffProfileOwnError extends ForbiddenError {
  constructor() {
    super({ reason: "staff_profile.own_profile", message: "The acting account is on this cargo." });
  }
}

/** Anti-escalation (CLAUDE.md §8): handing out, or reaching, a permission the actor does not hold. */
export class StaffProfileBeyondOwnPermissionsError extends ForbiddenError {
  constructor() {
    super({
      reason: "staff_profile.beyond_own_permissions",
      message: "The acting account does not hold every permission this asks for.",
    });
  }
}

export class StaffProfilePermissionNotGrantableError extends UnableToProcessEntryError {
  constructor() {
    super({
      reason: "staff_profile.permission_not_grantable",
      message: "A permission asked for is unknown, or is never handed out by a cargo.",
    });
  }
}

export class StaffProfileNameInvalidError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "staff_profile.name_invalid", message: "A cargo's name has 2 to 60 characters." });
  }
}

export class StaffProfileNameTakenError extends ConflictError {
  constructor() {
    super({ reason: "staff_profile.name_taken", message: "A live cargo already has this name." });
  }
}

/** A cargo still carried by an account, or by an invite waiting on the person. */
export class StaffProfileInUseError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "staff_profile.in_use", message: "Accounts or open invites are still on this cargo." });
  }
}
