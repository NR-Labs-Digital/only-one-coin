import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { ClassGroupModuleParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { CERTIFICATE_ISSUE_ROLES, CERTIFICATE_READ_ROLES } from "./issuedDocumentRoles.js";
import { CertificatePreviewSchema } from "./issuedDocumentSchemas.js";

/**
 * The certificate batch of a module group (OOC-33): who it would issue for and
 * who stays out, with the reason. Only the module group of the course's last
 * module issues (`closesTheCourse`); any other answers with no items. Writes
 * nothing.
 */
export const previewCertificateBatchRoute = RouteBuilder.get("/catalog/class-groups/:id/modules/:moduleId/certificates")
  .docs({
    tags: ["Documents"],
    summary: "Preview a module group's certificate batch",
    description:
      "Every confirmed seat in the module group of the course's last module, with the last module's grade and why the certificate would not go out (null = it would). Writes nothing.",
  })
  .roles(...CERTIFICATE_READ_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .response(200, CertificatePreviewSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const preview = await container.documents.issued.previewCertificates({
      classGroupId: request.params.id,
      moduleId: request.params.moduleId,
    });
    reply.status(200).send({
      ...preview,
      items: preview.items.map((item) => ({
        ...item,
        issued: item.issued ? { ...item.issued, issuedAt: item.issued.issuedAt.toISOString() } : null,
      })),
    });
  });

const IssueCertificatesBodySchema = z.object({
  /** The enrollments the person confirmed — the API issues only those that still qualify. */
  enrollmentIds: z.array(z.string().uuid()).min(1).max(500),
  /** Inglés Básico: coordination marks the certification exam passed, in the batch. */
  examApprovedEnrollmentIds: z.array(z.string().uuid()).max(500).default([]),
});

/**
 * Confirms the batch (OOC-33): a person, never a date (CLAUDE.md §1). The rule
 * runs again; what still qualifies is issued in one transaction, with the
 * e-mails and the audit entries. 422 `certificate.nothing_to_issue` when
 * nothing does, `certificate.not_last_module` off the last module,
 * `document_template.not_published` without a published certificate.
 */
export const issueCertificateBatchRoute = RouteBuilder.post("/catalog/class-groups/:id/modules/:moduleId/certificates")
  .docs({
    tags: ["Documents"],
    summary: "Issue a module group's certificate batch",
  })
  .roles(...CERTIFICATE_ISSUE_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .body(IssueCertificatesBodySchema)
  .response(200, z.object({ issued: z.number().int(), skipped: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.documents.issued.issueCertificates({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      moduleId: request.params.moduleId,
      enrollmentIds: request.body.enrollmentIds,
      examApprovedEnrollmentIds: request.body.examApprovedEnrollmentIds,
    });
    reply.status(200).send(result);
  });
