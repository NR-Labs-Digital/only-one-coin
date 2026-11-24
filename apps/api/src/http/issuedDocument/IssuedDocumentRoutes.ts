import { z } from "zod";
import { StudentNotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import {
  IssuedDocumentListSchema,
  RevokeIssuedDocumentBodySchema,
  serializeIssuedDocuments,
} from "./issuedDocumentSchemas.js";

/** The documents the institution issued about a student (OOC-33), newest first. */
export const listStudentIssuedDocumentsRoute = RouteBuilder.get("/students/:studentId/issued-documents")
  .docs({ tags: ["Documents"], summary: "List a student's issued documents" })
  .can("students.view")
  .params(z.object({ studentId: z.string().uuid() }))
  .response(200, IssuedDocumentListSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const repository = container.repositories.issuedDocuments;
    if (!(await repository.studentExists(request.params.studentId))) throw new StudentNotFoundError();
    reply.status(200).send(serializeIssuedDocuments(await repository.listForStudents([request.params.studentId])));
  });

/**
 * An issued document's PDF (OOC-33), printed from its template version and
 * the data frozen on issue, its verification code in the frame. Every print
 * is written to audit_log.
 */
export const downloadIssuedDocumentRoute = RouteBuilder.get("/issued-documents/:id/pdf")
  .docs({
    tags: ["Documents"],
    summary: "Download an issued document as PDF",
    description: "Responds with the PDF itself (application/pdf).",
  })
  .can("students.view")
  .params(z.object({ id: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, code } = await container.documents.issued.download({
      actorId: request.currentUser!.id,
      documentId: request.params.id,
      portalAccount: false,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Cache-Control", "no-store")
      .header("X-Document-Code", code)
      .send(Buffer.from(pdf));
  });

/**
 * Revokes an issued document (OOC-59): from now on the validation page says
 * "revoked" for its code. A reason is required; the revocation is never undone.
 */
export const revokeIssuedDocumentRoute = RouteBuilder.post("/issued-documents/:id/revoke")
  .docs({ tags: ["Documents"], summary: "Revoke an issued document" })
  .can("students.revoke_document")
  .params(z.object({ id: z.string().uuid() }))
  .body(RevokeIssuedDocumentBodySchema)
  .response(201, z.object({ revocationId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.documents.issued.revoke({
      actorId: request.currentUser!.id,
      documentId: request.params.id,
      reason: request.body.reason,
    });
    reply.status(201).send(result);
  });
