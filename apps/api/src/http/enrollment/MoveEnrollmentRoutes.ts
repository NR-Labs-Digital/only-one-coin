import { EnrollmentNotFoundError, MOVE_REASON_MAX_LENGTH } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { WeeklySlotSchema } from "@/http/catalog/CatalogSchemas.js";
import { MANUAL_ENROLLMENT_ROLES } from "./manualEnrollmentRoles.js";

const ParamsSchema = z.object({ id: z.string().uuid() });

const MoveTargetsResponseSchema = z.object({
  courseId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  classGroups: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      courseId: z.string().uuid(),
      courseName: z.string(),
      academicPeriodName: z.string(),
      schedule: z.string(),
      slots: z.array(WeeklySlotSchema),
      startsOn: z.string().nullable(),
      status: z.enum(["enrolling", "in_progress"]),
      module: z.number().int().nullable(),
      fullCourse: z.boolean(),
      capacity: z.number().int(),
      seatsTaken: z.number().int(),
      seatsOver: z.number().int(),
    }),
  ),
  plans: z.array(
    z.object({
      id: z.string().uuid(),
      courseId: z.string().uuid(),
      name: z.string(),
      amountCents: z.number().int(),
    }),
  ),
});

// The same three who open a manual enrollment move one (decision of
// 14/11/2026): a seat is an enrollment-supervision act, never billing's.
export const listEnrollmentMoveTargetsRoute = RouteBuilder.get("/enrollments/:id/move-targets")
  .docs({
    tags: ["Enrollments"],
    summary: "Class groups an enrollment can be moved to, and the plans of their courses",
    description:
      "Every running class group (enrolling or in progress, nothing retired) except the enrollment's own, full ones included with their seat counters, and the live plans of those courses with the price in force.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .response(200, MoveTargetsResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const targets = await container.queries.listMoveTargets.run(request.params.id);
    if (!targets) throw new EnrollmentNotFoundError();
    reply.status(200).send({
      ...targets,
      classGroups: targets.classGroups.map((group) => ({
        ...group,
        // jsonb comes back untyped; the response schema names its shape.
        slots: group.slots as z.infer<typeof WeeklySlotSchema>[],
        status: group.status as "enrolling" | "in_progress",
      })),
    });
  });

export const moveEnrollmentRoute = RouteBuilder.post("/enrollments/:id/move")
  .docs({
    tags: ["Enrollments"],
    summary: "Move an enrollment to another class group (OOC-84)",
    description:
      "Staff tool, free of charge: the payment never changes. Another course requires planId (a live plan of that course; the enrollment takes its price in force). A full target is 422 enrollment.class_group_full unless allowOverCapacity is true (OOC-155). Refusals: 422 enrollment.move_<seat_released|graded|same_class_group|target_unavailable|plan_required|plan_not_of_course|plan_not_allowed|reason_required>; 409 enrollment.move_conflict when the enrollment changed meanwhile.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .body(
    z.object({
      classGroupId: z.string().uuid(),
      planId: z.string().uuid().nullable().default(null),
      allowOverCapacity: z.boolean().default(false),
      reason: z.string().max(MOVE_REASON_MAX_LENGTH * 2),
    }),
  )
  .response(
    200,
    z.object({
      enrollmentId: z.string().uuid(),
      classGroupId: z.string().uuid(),
      overCapacity: z.boolean(),
      planChanged: z.boolean(),
    }),
  )
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.move.run({
      actorId: request.currentUser!.id,
      enrollmentId: request.params.id,
      ...request.body,
    });
    reply.status(200).send(result);
  });
