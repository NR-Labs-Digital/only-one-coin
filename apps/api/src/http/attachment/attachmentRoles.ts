import type { AttachmentStaffPolicy, Role } from "@ooc/domain";
import { STUDENT_FILE_ROLES } from "@/http/student/studentRoles.js";

/**
 * Which staff cargos reach each owner's files (OOC-143). A student's files are
 * the student file's: the same three who read and correct it list, attach,
 * download and remove them — `sales`, `support` and `billing` do not, since a
 * scanned DNI is the kind of thing the ficha already keeps from them. Proposed
 * in the ticket's spirit, to confirm with the owner; a different answer is one
 * line here.
 */
export const ATTACHMENT_STAFF_POLICY = {
  student: STUDENT_FILE_ROLES,
} as const satisfies AttachmentStaffPolicy;

/** Every staff cargo some owner type lets in — the routes' gate. The usecase
 * then checks the owner type the request actually names. */
export const ATTACHMENT_STAFF_ROLES = [...new Set(Object.values(ATTACHMENT_STAFF_POLICY).flat())] as [
  Role,
  ...Role[],
];
