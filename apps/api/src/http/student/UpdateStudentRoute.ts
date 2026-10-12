import { CreateStudentSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

const StudentParamsSchema = z.object({ studentId: z.string().uuid() });

const StudentResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
});

/**
 * A staff correction to the student file (OOC-74). The body is the whole
 * record as the form holds it — PUT, not PATCH — and the usecase works out
 * what changed. Same field rules as registration, minus the checkout's Gmail
 * gate (OOC-65 decides that for the backoffice). Writes audit_log.
 */
export const updateStudentRoute = RouteBuilder.put("/students/:studentId")
  .docs({
    tags: ["Students"],
    summary: "Correct a student's data",
    description:
      "The only path that rewrites name, document and birth date. Refuses a document already on another file and a minor with no guardian.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .params(StudentParamsSchema)
  .body(CreateStudentSchema)
  .response(200, StudentResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const student = await container.useCases.student.update.run({
      actorId: request.currentUser!.id,
      studentId: request.params.studentId,
      student: request.body,
    });

    reply.status(200).send({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      nationalIdType: student.nationalIdType,
      nationalId: student.nationalId,
      email: student.email,
      phone: student.phone,
      birthDate: student.birthDate.toISOString().slice(0, 10),
      country: student.country,
      region: student.region,
      city: student.city,
    });
  });
