import { CreateStudentSchema, GuardianFieldsSchema, refineNationalId } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

// Same field rules as the public checkout, minus its Gmail gate — whether the
// backoffice is held to that is OOC-65's call.
const RegisterStudentBodySchema = z.object({
  student: CreateStudentSchema,
  guardian: GuardianFieldsSchema.omit({ studentId: true }).superRefine(refineNationalId).nullable(),
});

const GuardianResponseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  relationship: z.enum(["mother", "father", "legal_guardian"]),
  nationalIdType: z.enum(["DNI", "CE", "passport"]),
  nationalId: z.string(),
  email: z.string(),
  phone: z.string(),
});

const RegisterStudentResponseSchema = z.object({
  student: z.object({
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
  }),
  guardian: GuardianResponseSchema.nullable(),
});

// management + enrollment supervision only — the manual backoffice registration flow
// (CLAUDE.md §1, "/backoffice/students"). It never enrolls anyone; it only
// creates the person record.
export const registerStudentRoute = RouteBuilder.post("/students")
  .docs({
    tags: ["Students"],
    summary: "Register a student (and optional guardian) from the backoffice",
    description:
      "Manual registration exception — the documented path is the student filling the public enrollment form themselves.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .body(RegisterStudentBodySchema)
  .response(201, RegisterStudentResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { student, guardian } = request.body;

    const result = await container.useCases.student.register.run({
      actorId: request.currentUser!.id,
      student,
      guardian,
    });

    reply.status(201).send({
      student: { ...result.student, birthDate: result.student.birthDate.toISOString().slice(0, 10) },
      guardian: result.guardian,
    });
  });
