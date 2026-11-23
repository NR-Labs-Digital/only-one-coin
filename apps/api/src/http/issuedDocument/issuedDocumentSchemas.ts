import { CERTIFICATE_BLOCK_REASONS, ISSUED_DOCUMENT_KINDS, ISSUED_DOCUMENT_STATUSES } from "@ooc/domain";
import { z } from "zod";
import type { IssuedDocumentListItem } from "@/infra/persistence/document/DrizzleIssuedDocumentRepository.js";

export const IssuedDocumentItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(ISSUED_DOCUMENT_KINDS),
  code: z.string(),
  courseName: z.string(),
  issuedAt: z.string().datetime(),
  /** Valid, revoked or replaced (OOC-59) — what the validation page says too. */
  status: z.enum(ISSUED_DOCUMENT_STATUSES),
  revokedAt: z.string().datetime().nullable(),
});

export const IssuedDocumentListSchema = z.object({ items: z.array(IssuedDocumentItemSchema) });

export function serializeIssuedDocuments(items: IssuedDocumentListItem[]): z.infer<typeof IssuedDocumentListSchema> {
  return {
    items: items.map((item) => ({
      ...item,
      issuedAt: item.issuedAt.toISOString(),
      revokedAt: item.revokedAt?.toISOString() ?? null,
    })),
  };
}

export const RevokeIssuedDocumentBodySchema = z.object({ reason: z.string().max(2000) });

/** The validation page's answer (OOC-59): public fields only, never a document number or contact. */
export const PublicIssuedDocumentSchema = z.object({
  kind: z.enum(ISSUED_DOCUMENT_KINDS),
  status: z.enum(ISSUED_DOCUMENT_STATUSES),
  studentName: z.string(),
  courseName: z.string(),
  /** Calendar days (`YYYY-MM-DD`) the document printed; null when it printed none. */
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  issuedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

const GradeSchema = z.union([
  z.object({ score: z.number(), didNotSit: z.literal(false) }),
  z.object({ score: z.null(), didNotSit: z.literal(true) }),
]);

export const CertificatePreviewSchema = z.object({
  closesTheCourse: z.boolean(),
  examRequired: z.boolean(),
  templatePublished: z.boolean(),
  items: z.array(
    z.object({
      enrollmentId: z.string().uuid(),
      studentId: z.string().uuid(),
      studentName: z.string(),
      lastModuleGrade: GradeSchema.nullable(),
      blockReason: z.enum(CERTIFICATE_BLOCK_REASONS).nullable(),
      issued: z.object({ id: z.string().uuid(), code: z.string(), issuedAt: z.string().datetime() }).nullable(),
    }),
  ),
});
