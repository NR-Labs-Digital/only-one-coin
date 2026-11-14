import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { PortalProfileQuerySchema, requestedProfile } from "@/http/portal/profileQuery.js";
import { attachmentList, AttachmentListSchema, UploadBodyFields, UploadTargetSchema } from "./attachmentSchemas.js";

/*
 * A signed-in student's own files (OOC-143). No owner in the request: the
 * owner is always a student file behind the session's account — for a list
 * and an upload, the chosen profile's (`?profile=`, OOC-147) — and a file id
 * of someone else answers like one that does not exist (CLAUDE.md §8). No
 * remove route — what the student sent is the coordination's record.
 */

const IdParamsSchema = z.object({ attachmentId: z.string().uuid() });

const actorOf = (request: { currentUser?: { id: string } }) => ({
  userId: request.currentUser!.id,
  role: "student" as const,
});

/** The chosen profile (OOC-147): which child a list or an upload is about.
 * Checked against the account by the owners port, never trusted. */
const profileActorOf = (request: { currentUser?: { id: string }; query: { profile?: string | undefined } }) => ({
  ...actorOf(request),
  profileId: requestedProfile(request.query),
});

export const listPortalAttachmentsRoute = RouteBuilder.get("/portal/attachments")
  .docs({ tags: ["Portal"], summary: "The student's own files, newest first" })
  .roles("student")
  .query(PortalProfileQuerySchema)
  .response(200, AttachmentListSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.useCases.attachment.list.run({ actor: profileActorOf(request), owner: null });
    reply.status(200).send(attachmentList(items, container.config.ATTACHMENT_MAX_UPLOAD_BYTES));
  });

export const requestPortalAttachmentUploadRoute = RouteBuilder.post("/portal/attachments/uploads")
  .docs({ tags: ["Portal"], summary: "Mint a signed upload target for one of the student's files" })
  .roles("student")
  .query(PortalProfileQuerySchema)
  .body(z.object(UploadBodyFields))
  .response(201, UploadTargetSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.attachment.requestUpload.run({
      actor: profileActorOf(request),
      owner: null,
      ...request.body,
    });
    reply.status(201).send({
      attachmentId: result.attachmentId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });

export const confirmPortalAttachmentUploadRoute = RouteBuilder.post("/portal/attachments/:attachmentId/confirm")
  .docs({ tags: ["Portal"], summary: "Confirm the student's file landed" })
  .roles("student")
  .params(IdParamsSchema)
  .body(z.object({}))
  .response(200, z.object({ attachmentId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.attachment.confirmUpload.run({
      actor: actorOf(request),
      attachmentId: request.params.attachmentId,
    });
    reply.status(200).send(result);
  });

export const downloadPortalAttachmentRoute = RouteBuilder.get("/portal/attachments/:attachmentId/download")
  .docs({ tags: ["Portal"], summary: "A five-minute link to one of the student's files" })
  .roles("student")
  .params(IdParamsSchema)
  .response(200, z.object({ url: z.string() }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.attachment.open.run({
      actor: actorOf(request),
      attachmentId: request.params.attachmentId,
    });
    reply.status(200).send(result);
  });
