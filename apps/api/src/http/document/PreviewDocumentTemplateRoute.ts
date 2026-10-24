import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DOCUMENT_TEMPLATE_ROLES } from "./documentRoles.js";
import { DocumentBodySchema, DocumentKindParamsSchema } from "./documentSchemas.js";

/**
 * The editor's live preview (OOC-123): the PDF exactly as it would be printed,
 * through the same engine, frame and WeasyPrint as a real document. Writes
 * nothing. Synchronous on purpose — the person is waiting for it — and bounded
 * by the renderer's own concurrency cap and the staff rate limit.
 */
export const previewDocumentTemplateRoute = RouteBuilder.post("/document-templates/:kind/preview")
  .docs({
    tags: ["Documents"],
    summary: "Preview a document template as PDF",
    description:
      "Renders the given text (or the draft, the published version, the starter) with the sample data or a real teacher. Base64 PDF.",
  })
  .roles(...DOCUMENT_TEMPLATE_ROLES)
  .params(DocumentKindParamsSchema)
  .body(z.object({ body: DocumentBodySchema.optional(), teacherId: z.string().uuid().optional() }))
  .response(200, z.object({ pdf: z.string() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const pdf = await container.documents.preview.preview({
      kind: request.params.kind,
      body: request.body.body,
      teacherId: request.body.teacherId,
    });
    reply.status(200).send({ pdf: Buffer.from(pdf).toString("base64") });
  });
