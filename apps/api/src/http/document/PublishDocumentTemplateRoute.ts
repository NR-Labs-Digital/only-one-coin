import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DOCUMENT_TEMPLATE_ROLES } from "./documentRoles.js";
import { DocumentKindParamsSchema } from "./documentSchemas.js";

/**
 * Publishes the draft as the next immutable version (OOC-123) — what documents
 * are issued from from now on. Refused while the draft has issues. Writes
 * audit_log.
 */
export const publishDocumentTemplateRoute = RouteBuilder.post("/document-templates/:kind/publish")
  .docs({
    tags: ["Documents"],
    summary: "Publish a document template draft",
    description: "Creates the next numbered, append-only version from the draft. Refused while the draft has issues.",
  })
  .roles(...DOCUMENT_TEMPLATE_ROLES)
  .params(DocumentKindParamsSchema)
  .response(200, z.object({ version: z.number().int(), publishedAt: z.string() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const version = await container.useCases.document.publish.run({
      actorId: request.currentUser!.id,
      kind: request.params.kind,
    });
    reply.status(200).send({ version: version.version, publishedAt: version.createdAt.toISOString() });
  });
