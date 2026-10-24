import { DocumentKindNotFoundError } from "@ooc/domain";
import { placeholdersOf } from "@ooc/templates";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DOCUMENT_KINDS, isDocumentKind } from "@/documents/documentKinds.js";
import { DOCUMENT_TEMPLATE_ROLES } from "./documentRoles.js";
import { DocumentKindParamsSchema, DocumentTemplateIssueSchema } from "./documentSchemas.js";

/**
 * Everything the editor opens with (OOC-123): the placeholders it may offer
 * (paths and types — the labels are the app's, in its locale files), the
 * draft with what is wrong with it, the version in force, and the starter
 * text to fall back to.
 */
export const getDocumentTemplateRoute = RouteBuilder.get("/document-templates/:kind")
  .docs({
    tags: ["Documents"],
    summary: "Open a document template in the editor",
    description: "Placeholders, draft (with its issues), the published version and the starter text.",
  })
  .roles(...DOCUMENT_TEMPLATE_ROLES)
  .params(DocumentKindParamsSchema)
  .response(
    200,
    z.object({
      kind: z.string(),
      placeholders: z.array(
        z.object({ path: z.string(), type: z.string(), optional: z.boolean(), description: z.string().optional() }),
      ),
      draft: z
        .object({ body: z.string(), updatedAt: z.string(), issues: z.array(DocumentTemplateIssueSchema) })
        .nullable(),
      published: z.object({ version: z.number().int(), body: z.string(), publishedAt: z.string() }).nullable(),
      starterBody: z.string(),
    }),
  )
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { kind } = request.params;
    if (!isDocumentKind(kind)) throw new DocumentKindNotFoundError();

    const { templates } = container.repositories;
    const [draft, published] = await Promise.all([templates.findDraft(kind), templates.findPublished(kind)]);
    const entry = DOCUMENT_KINDS[kind];

    reply.status(200).send({
      kind,
      placeholders: placeholdersOf(entry.kind),
      draft: draft
        ? {
            body: draft.body,
            updatedAt: draft.updatedAt.toISOString(),
            issues: container.documents.compiler.check(kind, draft.body),
          }
        : null,
      published: published
        ? { version: published.version, body: published.body, publishedAt: published.createdAt.toISOString() }
        : null,
      starterBody: entry.starterBody,
    });
  });
