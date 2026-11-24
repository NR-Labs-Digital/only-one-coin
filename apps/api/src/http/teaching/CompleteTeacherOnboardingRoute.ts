import { TeacherOnboardingSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { serializeTeacher, TeacherRecordResponseSchema } from "@/http/teacher/teacherSchemas.js";

/**
 * The teacher completes their own file, once (OOC-103). No id in the address:
 * the file is the one linked to the session's account (OOC-79, anti-IDOR).
 * A complete file answers 422 `teacher.onboarding_closed`; an account with no
 * file, 404. Writes audit_log with the field names, never the values.
 */
export const completeTeacherOnboardingRoute = RouteBuilder.put("/teaching/onboarding")
  .docs({
    tags: ["Teaching"],
    summary: "Complete the signed-in teacher's own file",
    description:
      "Document, phone, origin, address and the week — once, on a file coordination registered with name, e-mail and languages only.",
  })
  .roles("teacher")
  .body(TeacherOnboardingSchema)
  .response(200, TeacherRecordResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const teacher = await container.useCases.teacher.completeOnboarding.run({
      userId: request.currentUser!.id,
      data: request.body,
    });

    reply.status(200).send(serializeTeacher(teacher));
  });
