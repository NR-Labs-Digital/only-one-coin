import { CERTIFICATE_BLOCK_REASONS, ISSUED_DOCUMENT_KINDS } from "@ooc/domain";
import { z } from "zod";

export const IssuedDocumentItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(ISSUED_DOCUMENT_KINDS),
  code: z.string(),
  courseName: z.string(),
  issuedAt: z.string().datetime(),
});

export const IssuedDocumentListSchema = z.object({ items: z.array(IssuedDocumentItemSchema) });

export function serializeIssuedDocuments(
  items: { id: string; kind: (typeof ISSUED_DOCUMENT_KINDS)[number]; code: string; courseName: string; issuedAt: Date }[],
): z.infer<typeof IssuedDocumentListSchema> {
  return { items: items.map((item) => ({ ...item, issuedAt: item.issuedAt.toISOString() })) };
}

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
