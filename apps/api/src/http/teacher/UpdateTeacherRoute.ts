import { TeacherDataSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { serializeTeacher, TeacherParamsSchema, TeacherRecordResponseSchema } from "./teacherSchemas.js";

/**
 * Corrects the teacher file minus the week (OOC-78). PUT, not PATCH: the body
 * is the whole record as the form holds it and the usecase works out what
 * changed. Writes audit_log with the field names, never the values.
 */
export const updateTeacherRoute = RouteBuilder.put("/teachers/:teacherId")
  .docs({
    tags: ["Teachers"],
    summary: "Correct a teacher's data",
    description: "Refuses a document already on another teacher's file.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .body(TeacherDataSchema)
  .response(200, TeacherRecordResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const teacher = await container.useCases.teacher.update.run({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      teacher: request.body,
    });

    reply.status(200).send(serializeTeacher(teacher));
  });
