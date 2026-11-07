import { ATTACHMENT_OWNER_TYPES, type AuthenticatedUser } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { ATTACHMENT_STAFF_ROLES } from "./attachmentRoles.js";
import { attachmentList, AttachmentListSchema, UploadBodyFields, UploadTargetSchema } from "./attachmentSchemas.js";

/*
 * Files sent to the platform, from the panel (OOC-143). Generic by owner: the
 * request names `ownerType` + `ownerId`, and the usecase checks that the
 * session's cargo reaches that owner type and that the owner exists. The file
 * goes straight to the bucket; the API names the key (`documents/<id>`).
 */

const OwnerSchema = {
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: z.string().uuid(),
};
const IdParamsSchema = z.object({ attachmentId: z.string().uuid() });

const actorOf = (request: { currentUser?: AuthenticatedUser }) => ({
  userId: request.currentUser!.id,
  role: request.currentUser!.role,
});

export const listAttachmentsRoute = RouteBuilder.get("/attachments")
  .docs({ tags: ["Attachments"], summary: "List an owner's files, newest first" })
  .roles(...ATTACHMENT_STAFF_ROLES)
  .query(z.object(OwnerSchema))
  .response(200, AttachmentListSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.useCases.attachment.list.run({
      actor: actorOf(request),
      owner: { type: request.query.ownerType, id: request.query.ownerId },
    });
    reply.status(200).send(attachmentList(items, container.config.ATTACHMENT_MAX_UPLOAD_BYTES));
  });

export const requestAttachmentUploadRoute = RouteBuilder.post("/attachments/uploads")
  .docs({
    tags: ["Attachments"],
    summary: "Mint a signed upload target for a new file",
    description: "The row is born pending; the browser POSTs the file straight to the bucket, then confirms.",
  })
  .roles(...ATTACHMENT_STAFF_ROLES)
  .body(z.object({ ...OwnerSchema, ...UploadBodyFields }))
  .response(201, UploadTargetSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { ownerType, ownerId, ...file } = request.body;
    const result = await container.useCases.attachment.requestUpload.run({
      actor: actorOf(request),
      owner: { type: ownerType, id: ownerId },
      ...file,
    });
    reply.status(201).send({
      attachmentId: result.attachmentId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });

export const confirmAttachmentUploadRoute = RouteBuilder.post("/attachments/:attachmentId/confirm")
  .docs({
    tags: ["Attachments"],
    summary: "Confirm a file landed and list it",
    description: "Reads the object: type from its magic bytes, size and sha256 from its bytes.",
  })
  .roles(...ATTACHMENT_STAFF_ROLES)
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

export const downloadAttachmentRoute = RouteBuilder.get("/attachments/:attachmentId/download")
  .docs({
    tags: ["Attachments"],
    summary: "A five-minute link to a file, saved under its original name",
    description: "Each call is logged (attachment.downloaded).",
  })
  .roles(...ATTACHMENT_STAFF_ROLES)
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

export const removeAttachmentRoute = RouteBuilder.delete("/attachments/:attachmentId")
  .docs({
    tags: ["Attachments"],
    summary: "Take a file off the list (soft delete)",
    description: "The row gets deleted_at and the object stays in the bucket. Logged (attachment.removed).",
  })
  .roles(...ATTACHMENT_STAFF_ROLES)
  .params(IdParamsSchema)
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.attachment.remove.run({
      actor: actorOf(request),
      attachmentId: request.params.attachmentId,
    });
    reply.status(204).send();
  });
