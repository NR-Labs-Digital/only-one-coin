import { TeacherNotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_READ_ROLES } from "./teacherRoles.js";
import { serializeTeacherDetail, TeacherDetailResponseSchema, TeacherParamsSchema } from "./teacherSchemas.js";

export const getTeacherRoute = RouteBuilder.get("/teachers/:teacherId")
  .docs({
    tags: ["Teachers"],
    summary: "One teacher's file",
    description: "Contact, languages, the declared week, the current contract and the class groups allocated to them.",
  })
  .roles(...TEACHER_READ_ROLES)
  .params(TeacherParamsSchema)
  .response(200, TeacherDetailResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const teacher = await container.queries.getTeacher.run(request.params.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    reply.status(200).send(serializeTeacherDetail(teacher));
  });
