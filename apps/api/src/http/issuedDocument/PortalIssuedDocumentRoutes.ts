import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { PortalProfileQuerySchema, requestedProfile } from "@/http/portal/profileQuery.js";
import { profilesOfAccount, pickProfile } from "@/infra/persistence/portal/accountProfiles.js";
import { IssuedDocumentListSchema, serializeIssuedDocuments } from "./issuedDocumentSchemas.js";

/**
 * The chosen profile's issued documents (OOC-33; profiles OOC-147): every file
 * of that person on the account. Same profile rule as the attached files.
 */
export const listPortalIssuedDocumentsRoute = RouteBuilder.get("/portal/issued-documents")
  .docs({ tags: ["Portal"], summary: "List the issued documents of the chosen profile" })
  .roles("student")
  .query(PortalProfileQuerySchema)
  .response(200, IssuedDocumentListSchema)
  .handler(async (request, reply) => {
    const profiles = await profilesOfAccount(container.db, request.currentUser!.id);
    const profile = pickProfile(profiles, requestedProfile(request.query));
    const items = profile ? await container.repositories.issuedDocuments.listForStudents(profile.fileIds) : [];
    reply.status(200).send(serializeIssuedDocuments(items));
  });

/**
 * An issued document's PDF, for an account that reaches its file — anything
 * else is the same 404 (CLAUDE.md §8). Audited with the account as the actor.
 */
export const downloadPortalIssuedDocumentRoute = RouteBuilder.get("/portal/issued-documents/:id/pdf")
  .docs({ tags: ["Portal"], summary: "Download an own issued document as PDF" })
  .roles("student")
  .params(z.object({ id: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, code } = await container.documents.issued.download({
      actorId: request.currentUser!.id,
      documentId: request.params.id,
      portalAccount: true,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Cache-Control", "no-store")
      .header("X-Document-Code", code)
      .send(Buffer.from(pdf));
  });
