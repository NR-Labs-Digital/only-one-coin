import type { AttachmentActor, AttachmentOwner, AttachmentSource, AttachmentStaffPolicy } from "./Attachment.js";
import type { IAttachmentOwners } from "./AttachmentPorts.js";
import { AttachmentOwnerForbiddenError, AttachmentOwnerNotFoundError } from "./errors.js";

/**
 * Who reaches whose files. A student reaches only the files behind the
 * session's account — whatever owner the request named is ignored; a list and
 * an upload are about the chosen profile (OOC-147), any file of the account
 * opens. Staff
 * reach an owner type when their cargo is in the policy. A null scope id is
 * not an id (CLAUDE.md §8): an account with no file behind it reaches nothing.
 */
export class AttachmentAccess {
  constructor(
    private readonly owners: IAttachmentOwners,
    private readonly staffPolicy: AttachmentStaffPolicy,
  ) {}

  /**
   * The owners a list reads: for a student, every file of the chosen profile
   * (the same as the portal overview); for staff, the one asked for.
   */
  async ownersFor(actor: AttachmentActor, requested: AttachmentOwner | null): Promise<AttachmentOwner[]> {
    if (actor.role === "student") {
      const ids = await this.owners.studentsOfProfile(actor.userId, actor.profileId ?? null);
      if (ids.length === 0) throw new AttachmentOwnerNotFoundError();
      return ids.map((id) => ({ type: "student", id }));
    }
    return [await this.staffOwner(actor, requested)];
  }

  /** The owner a new upload hangs off: for a student, the chosen profile's
   * newest file — the identity `/portal/me` shows. */
  async ownerFor(actor: AttachmentActor, requested: AttachmentOwner | null): Promise<AttachmentOwner> {
    const [first] = await this.ownersFor(actor, requested);
    if (!first) throw new AttachmentOwnerNotFoundError();
    return first;
  }

  private async staffOwner(actor: AttachmentActor, requested: AttachmentOwner | null): Promise<AttachmentOwner> {
    if (!requested) throw new AttachmentOwnerNotFoundError();
    if (!this.staffReaches(actor, requested)) throw new AttachmentOwnerForbiddenError();
    if (!(await this.owners.exists(requested))) throw new AttachmentOwnerNotFoundError();
    return requested;
  }

  /** Whether the actor reaches a stored file's owner. */
  async reaches(actor: AttachmentActor, owner: AttachmentOwner): Promise<boolean> {
    if (actor.role === "student") {
      if (owner.type !== "student") return false;
      const ids = await this.owners.studentsOfAccount(actor.userId);
      return ids.includes(owner.id);
    }
    return this.staffReaches(actor, owner);
  }

  sourceOf(actor: AttachmentActor): AttachmentSource {
    return actor.role === "student" ? "portal" : "backoffice";
  }

  private staffReaches(actor: AttachmentActor, owner: AttachmentOwner): boolean {
    return this.staffPolicy[owner.type]?.includes(actor.role) ?? false;
  }
}
