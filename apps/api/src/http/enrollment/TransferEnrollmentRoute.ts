import { TRANSFER_REASON_MAX_LENGTH } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const ParamsSchema = z.object({ id: z.string().uuid() });

// A traspaso is a seat act, like moving and freezing one (OOC-84): the same
// three who open a manual enrollment. Free (docs/REGRAS-NEGOCIO.md §5), so
// there is no payment on the way.
export const transferEnrollmentRoute = RouteBuilder.post("/enrollments/:id/transfer")
  .docs({
    tags: ["Enrollments"],
    summary: "Hand an enrollment to another student (OOC-105)",
    description:
      "Traspaso de matrícula: the enrollment's student becomes toStudentId — a student already on file; the seat, the class group, the payment and the monthly modules bought go with it. Only a confirmed seat, of a course that offers it, in a class group enrolling or in progress. The destination's portal account opens as on a first approval. Refusals: 422 enrollment.transfer_<seat_not_confirmed|course_disallows|class_group_not_running|graded|procedure_open|same_student|student_already_enrolled|student_below_minimum_age|guardian_required|reason_required|student_not_found>; 409 enrollment.transfer_conflict when it changed meanwhile.",
  })
  .can("enrollments.transfer")
  .params(ParamsSchema)
  .body(
    z.object({
      toStudentId: z.string().uuid(),
      reason: z.string().max(TRANSFER_REASON_MAX_LENGTH * 2),
    }),
  )
  .response(
    200,
    z.object({
      enrollmentId: z.string().uuid(),
      studentId: z.string().uuid(),
      portalAccess: z.enum(["created", "linked_existing", "already_linked", "email_conflict"]),
    }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.transfer.run({
      actorId: request.currentUser!.id,
      enrollmentId: request.params.id,
      toStudentId: request.body.toStudentId,
      reason: request.body.reason,
    });
    reply.status(200).send(result);
  });
