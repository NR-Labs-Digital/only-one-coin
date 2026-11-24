import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { RegisterTeacherBodySchema, serializeTeacher, TeacherRecordResponseSchema } from "./teacherSchemas.js";

export const registerTeacherRoute = RouteBuilder.post("/teachers")
  .docs({
    tags: ["Teachers"],
    summary: "Register a teacher on the roster",
    description:
      "Creates the file only — the panel account is a staff invite and the contract is filed separately. With `onboarding: true`, only name, e-mail and languages: the teacher completes the rest after accepting the invite (OOC-103). Writes audit_log.",
  })
  .can("teachers.register")
  .body(RegisterTeacherBodySchema)
  .response(201, TeacherRecordResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const actorId = request.currentUser!.id;
    const body = request.body;
    const teacher = await container.useCases.teacher.register.run(
      body.onboarding ? { actorId, onboarding: true, teacher: body.teacher } : { actorId, teacher: body.teacher },
    );

    reply.status(201).send(serializeTeacher(teacher));
  });
