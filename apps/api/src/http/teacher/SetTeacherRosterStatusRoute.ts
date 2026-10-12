import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { TEACHER_EDIT_ROLES } from "./teacherRoles.js";
import { serializeTeacher, TeacherParamsSchema, TeacherRecordResponseSchema } from "./teacherSchemas.js";

const SetTeacherRosterStatusBodySchema = z.object({ status: z.enum(["active", "inactive"]) });

/**
 * Takes a teacher off the roster or back on (OOC-78). Leaving with class
 * groups still running is allowed — the answer counts them so the screen can
 * say so (CLAUDE.md §1, "avisa, não bloqueia"). Leaving closes the linked
 * panel account; rejoining reopens it. Writes audit_log.
 */
export const setTeacherRosterStatusRoute = RouteBuilder.put("/teachers/:teacherId/status")
  .docs({
    tags: ["Teachers"],
    summary: "Take a teacher off the roster or back on",
    description: "Never deletes. Answers how many class groups were still running with them.",
  })
  .roles(...TEACHER_EDIT_ROLES)
  .params(TeacherParamsSchema)
  .body(SetTeacherRosterStatusBodySchema)
  .response(
    200,
    z.object({ teacher: TeacherRecordResponseSchema, runningClassGroups: z.number().int() }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teacher.setRosterStatus.run({
      actorId: request.currentUser!.id,
      teacherId: request.params.teacherId,
      status: request.body.status,
    });

    reply.status(200).send({ teacher: serializeTeacher(result.teacher), runningClassGroups: result.runningClassGroups });
  });
