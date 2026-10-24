import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { serializeContract, TeacherContractResponseSchema, TeacherParamsSchema } from "./teacherSchemas.js";

/** Loose on purpose: the domain checks the fields and answers a code per field. */
const FileTeacherContractBodySchema = z.object({
  contractUploadId: z.string().uuid(),
  contract: z.object({
    fileName: z.string(),
    /** Calendar dates, `YYYY-MM-DD`. */
    startsOn: z.string(),
    endsOn: z.string(),
  }),
});

/**
 * Step two (OOC-81): files the uploaded PDF with the period it covers. A new
 * row every time — the history stays, the newest is in force. Writes audit_log.
 */
export const fileTeacherContractRoute = RouteBuilder.post("/teachers/:teacherId/contracts")
  .docs({
    tags: ["Teachers"],
    summary: "File a signed contract on a teacher",
    description:
      "File, start and end together or nothing. The upload must be a PDF; anything else is removed and refused.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .body(FileTeacherContractBodySchema)
  .response(201, TeacherContractResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const contract = await container.useCases.teacher.fileContract.run({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      contractUploadId: request.body.contractUploadId,
      contract: request.body.contract,
    });

    reply.status(201).send(
      serializeContract({
        id: contract.id,
        fileName: contract.fileName,
        fileSizeBytes: contract.fileSizeBytes,
        uploadedAt: contract.createdAt,
        startsOn: contract.startsOn,
        endsOn: contract.endsOn,
      }),
    );
  });
