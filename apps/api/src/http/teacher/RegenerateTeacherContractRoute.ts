import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_READ_ROLES } from "./teacherRoles.js";

/**
 * A recorded contract printed again (OOC-124), from the template version it
 * was generated from and the period recorded with it. The contract must
 * belong to the teacher in the URL; one filed as a PDF opens through
 * `…/file` instead. Who downloads is who reads the roster, the same as the
 * filed ones — the teacher does not. Every call is written to audit_log.
 */
export const regenerateTeacherContractRoute = RouteBuilder.get("/teachers/:teacherId/contracts/:contractId/document")
  .docs({
    tags: ["Teachers"],
    summary: "Download a recorded contract again as PDF",
    description:
      "Prints the contract from its recorded template version and period, with the teacher file as it is now. Responds with the PDF itself (application/pdf).",
  })
  .roles(...TEACHER_READ_ROLES)
  .params(z.object({ teacherId: z.string().uuid(), contractId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, templateVersion } = await container.documents.teacherContract.regenerate({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      contractId: request.params.contractId,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Cache-Control", "no-store")
      .header("X-Template-Version", String(templateVersion))
      .send(Buffer.from(pdf));
  });
