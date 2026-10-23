import { CreateTeacherSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_CREATE_ROLES } from "./teacherRoles.js";
import { serializeTeacher, TeacherRecordResponseSchema } from "./teacherSchemas.js";

export const registerTeacherRoute = RouteBuilder.post("/teachers")
  .docs({
    tags: ["Teachers"],
    summary: "Register a teacher on the roster",
    description:
      "Creates the file only — the panel account is a staff invite and the contract is filed separately. Writes audit_log.",
  })
  .roles(...TEACHER_CREATE_ROLES)
  .body(CreateTeacherSchema)
  .response(201, TeacherRecordResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const teacher = await container.useCases.teacher.register.run({
      actorId: request.currentUser!.id,
      teacher: request.body,
    });

    reply.status(201).send(serializeTeacher(teacher));
  });
