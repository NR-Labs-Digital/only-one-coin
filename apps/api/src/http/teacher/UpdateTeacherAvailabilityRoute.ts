import { TeacherAvailabilitySchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { serializeTeacher, TeacherParamsSchema, TeacherRecordResponseSchema } from "./teacherSchemas.js";

export const updateTeacherAvailabilityRoute = RouteBuilder.put("/teachers/:teacherId/availability")
  .docs({
    tags: ["Teachers"],
    summary: "Replace a teacher's weekly availability",
    description: "Windows in America/Lima, HH:mm, never overlapping on the same day. Writes audit_log.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .body(TeacherAvailabilitySchema)
  .response(200, TeacherRecordResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const teacher = await container.useCases.teacher.updateAvailability.run({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      availability: request.body.availability,
    });

    reply.status(200).send(serializeTeacher(teacher));
  });
