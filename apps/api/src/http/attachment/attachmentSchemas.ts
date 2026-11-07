import { ATTACHMENT_CATEGORIES, ATTACHMENT_CONTENT_TYPES, type AttachmentListItem } from "@ooc/domain";
import { z } from "zod";

export const AttachmentCategorySchema = z.enum(ATTACHMENT_CATEGORIES);

export const AttachmentItemSchema = z.object({
  id: z.string().uuid(),
  category: AttachmentCategorySchema,
  // The name the person gave the file — their data, shown as is.
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  source: z.enum(["portal", "backoffice"]),
  uploadedAt: z.string(),
  uploadedByName: z.string().nullable(),
});

/** The list carries the rules the screen checks before uploading — never a
 * constant in the app (CLAUDE.md §5). */
export const AttachmentListSchema = z.object({
  items: z.array(AttachmentItemSchema),
  limits: z.object({
    maxBytes: z.number().int(),
    contentTypes: z.array(z.enum(ATTACHMENT_CONTENT_TYPES)),
  }),
});

export const UploadBodyFields = {
  category: AttachmentCategorySchema,
  fileName: z.string().trim().min(1).max(500),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
};

export const UploadTargetSchema = z.object({
  attachmentId: z.string().uuid(),
  uploadUrl: z.string(),
  uploadFields: z.record(z.string(), z.string()),
  maxBytes: z.number().int(),
});

export function toAttachmentItem(item: AttachmentListItem): z.infer<typeof AttachmentItemSchema> {
  return { ...item, uploadedAt: item.uploadedAt.toISOString() };
}

export function attachmentList(items: AttachmentListItem[], maxBytes: number): z.infer<typeof AttachmentListSchema> {
  return {
    items: items.map(toAttachmentItem),
    limits: { maxBytes, contentTypes: [...ATTACHMENT_CONTENT_TYPES] },
  };
}
