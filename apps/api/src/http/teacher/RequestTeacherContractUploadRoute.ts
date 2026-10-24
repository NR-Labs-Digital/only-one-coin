import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { TeacherParamsSchema } from "./teacherSchemas.js";

/**
 * Step one of filing a contract (OOC-81): a presigned POST the panel sends the
 * PDF to, straight to the bucket. Writes nothing — the row is born at filing.
 */
export const requestTeacherContractUploadRoute = RouteBuilder.post("/teachers/:teacherId/contract-uploads")
  .docs({
    tags: ["Teachers"],
    summary: "Get an upload target for a signed contract",
    description: "PDF only, capped by the bucket's own policy. File it afterwards with POST /teachers/:teacherId/contracts.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .response(
    201,
    z.object({
      contractUploadId: z.string().uuid(),
      uploadUrl: z.string().url(),
      uploadFields: z.record(z.string()),
      maxBytes: z.number().int(),
    }),
  )
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teacher.requestContractUpload.run({ teacherId: request.params.teacherId });
    reply.status(201).send({
      contractUploadId: result.contractUploadId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });
