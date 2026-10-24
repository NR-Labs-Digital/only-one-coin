import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_READ_ROLES } from "./teacherRoles.js";

/**
 * A five-minute download link for a contract filed as a PDF (OOC-81); one
 * generated from the template (OOC-124) prints via `…/document`. The contract
 * must belong to the teacher in the URL. Every call is written to audit_log.
 * The teacher themself does not download here — only the panel that reads
 * the roster.
 */
export const openTeacherContractRoute = RouteBuilder.get("/teachers/:teacherId/contracts/:contractId/file")
  .docs({
    tags: ["Teachers"],
    summary: "Get a 5-minute download URL for a filed contract",
    description: "The only way a person opens a contract. Every call is written to the audit log.",
  })
  .roles(...TEACHER_READ_ROLES)
  .params(z.object({ teacherId: z.string().uuid(), contractId: z.string().uuid() }))
  .response(200, z.object({ url: z.string().url(), expiresAt: z.string() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teacher.openContract.run({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      contractId: request.params.contractId,
    });
    reply.status(200).send({ url: result.url, expiresAt: result.expiresAt.toISOString() });
  });
