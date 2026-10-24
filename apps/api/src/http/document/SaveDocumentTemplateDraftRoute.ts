import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DOCUMENT_TEMPLATE_ROLES } from "./documentRoles.js";
import { DocumentBodySchema, DocumentKindParamsSchema, DocumentTemplateIssueSchema } from "./documentSchemas.js";

/**
 * Saves the editor's text as the draft (OOC-123). Always saves — a draft may be
 * wrong — and answers with the sanitized text and what would stop it from
 * being published.
 */
export const saveDocumentTemplateDraftRoute = RouteBuilder.put("/document-templates/:kind/draft")
  .docs({
    tags: ["Documents"],
    summary: "Save a document template draft",
    description: "The text is sanitized to what a document may carry. The answer lists the issues to fix before publishing.",
  })
  .roles(...DOCUMENT_TEMPLATE_ROLES)
  .params(DocumentKindParamsSchema)
  .body(z.object({ body: DocumentBodySchema }))
  .response(
    200,
    z.object({ body: z.string(), updatedAt: z.string(), issues: z.array(DocumentTemplateIssueSchema) }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.document.saveDraft.run({
      actorId: request.currentUser!.id,
      kind: request.params.kind,
      body: request.body.body,
    });
    reply.status(200).send({
      body: result.draft.body,
      updatedAt: result.draft.updatedAt.toISOString(),
      issues: result.issues,
    });
  });
