import type { AttachmentCategory, AttachmentOwner } from "./Attachment.js";

/**
 * What an attachment entry in `audit_log` carries: whose file and what kind —
 * never the file's name, which is often the person's name (CLAUDE.md §8). The
 * student's id travels as `studentId`, which is how the general log links the
 * entry to the file (`auditCatalog.ts`, `metadata_student`).
 */
export function attachmentAuditMetadata(owner: AttachmentOwner, category: AttachmentCategory): Record<string, unknown> {
  return {
    ownerType: owner.type,
    ownerId: owner.id,
    category,
    ...(owner.type === "student" ? { studentId: owner.id } : {}),
  };
}
