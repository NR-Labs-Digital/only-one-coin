import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";

const TeachingStudentSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentName: z.string(),
});

// Who is in one of the teacher's class groups: names only — no document,
// contact or payment, which `/catalog/class-groups/:id/roster` carries for
// coordination. The class group is checked as the teacher's before any
// student is read.
export const listOwnClassGroupStudentsRoute = RouteBuilder.get("/teaching/class-groups/:id/students")
  .docs({
    tags: ["Teaching"],
    summary: "The students of one of the signed-in teacher's class groups",
    description: "Confirmed seats only, in surname order, names only. Another teacher's class group answers 404.",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, z.object({ items: z.array(TeachingStudentSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const students = await container.useCases.teaching.listOwnClassGroupStudents.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send({
      items: students.map((student) => ({
        enrollmentId: student.enrollmentId,
        studentName: `${student.firstName} ${student.lastName}`,
      })),
    });
  });
