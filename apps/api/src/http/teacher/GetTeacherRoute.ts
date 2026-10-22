import { TeacherNotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_OWN_FILE_ROLES } from "./teacherRoles.js";
import { serializeTeacherDetail, TeacherDetailResponseSchema, TeacherParamsSchema } from "./teacherSchemas.js";

/**
 * A `teacher` reaches only the file linked to their own account (OOC-79):
 * the id in the URL is compared against the one derived from the session,
 * never trusted by itself (CLAUDE.md §8, anti-IDOR). Another file answers 404,
 * the same as one that does not exist.
 */
export const getTeacherRoute = RouteBuilder.get("/teachers/:teacherId")
  .docs({
    tags: ["Teachers"],
    summary: "One teacher's file",
    description: "Contact, languages, the declared week, the current contract and the class groups allocated to them.",
  })
  .roles(...TEACHER_OWN_FILE_ROLES)
  .params(TeacherParamsSchema)
  .response(200, TeacherDetailResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    if (user.role === "teacher") {
      const own = await container.repositories.teacher.findByUserId(user.id);
      if (own?.id !== request.params.teacherId) throw new TeacherNotFoundError();
    }

    const [teacher, settings] = await Promise.all([
      container.queries.getTeacher.run(request.params.teacherId),
      container.repositories.platformSettings.get(),
    ]);
    if (!teacher) throw new TeacherNotFoundError();

    reply.status(200).send({ ...serializeTeacherDetail(teacher), contractAlertDays: settings.contractAlertDays });
  });
