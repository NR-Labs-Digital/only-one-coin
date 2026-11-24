import type { AttachmentOwnerType, AttachmentStaffPolicy, PermissionKey } from "@ooc/domain";
import { container } from "@/container.js";

/**
 * Which permission reaches each owner's files (OOC-143, as permissions since
 * OOC-183). A student's files are the student file's: whoever reads the file
 * lists and downloads them — the routes add `students.edit` to attach and
 * remove. By default that is the three who keep the file; `sales`, `support`
 * and `billing` do not, since a scanned DNI is the kind of thing the ficha
 * already keeps from them.
 */
const PERMISSION_BY_OWNER: Readonly<Record<AttachmentOwnerType, PermissionKey>> = {
  student: "students.view",
};

export const ATTACHMENT_STAFF_POLICY: AttachmentStaffPolicy = (actor, ownerType) =>
  container.identity.staffAccess.has({ role: actor.role, profileId: actor.cargoId ?? null }, PERMISSION_BY_OWNER[ownerType]);
