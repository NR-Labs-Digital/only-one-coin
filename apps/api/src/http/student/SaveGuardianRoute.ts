import { GuardianFieldsSchema, refineNationalId } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const StudentParamsSchema = z.object({ studentId: z.string().uuid() });

// Never carries consent: that is the guardian's own act (Ley 29733).
const SaveGuardianBodySchema = GuardianFieldsSchema.omit({ studentId: true }).superRefine(refineNationalId);

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

/**
 * Corrects the student's guardian, or puts one on file when there is none
 * (OOC-74) — one guardian per student, so PUT. A guardian added here starts
 * with consent pending. Writes audit_log.
 */
export const saveGuardianRoute = RouteBuilder.put("/students/:studentId/guardian")
  .docs({
    tags: ["Students"],
    summary: "Correct or add a student's guardian",
    description: "Creates the guardian when the student has none; never records consent.",
  })
  .can("students.edit")
  .params(StudentParamsSchema)
  .body(SaveGuardianBodySchema)
  .response(200, GuardianResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const guardian = await container.useCases.student.saveGuardian.run({
      actorId: request.currentUser!.id,
      studentId: request.params.studentId,
      guardian: request.body,
    });

    reply.status(200).send({
      id: guardian.id,
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      relationship: guardian.relationship,
      nationalIdType: guardian.nationalIdType,
      nationalId: guardian.nationalId,
      email: guardian.email,
      phone: guardian.phone,
    });
  });
