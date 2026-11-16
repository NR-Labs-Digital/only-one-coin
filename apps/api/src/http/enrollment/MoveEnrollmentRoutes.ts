import { EnrollmentNotFoundError, MOVE_REASON_MAX_LENGTH, SEAT_PLACEMENTS } from "@ooc/domain";
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
  /** The module run the seat is in now (OOC-156). */
  classGroupModuleId: z.string().uuid(),
  /** One entry per module run (OOC-156): `id` is the run's, `classGroupId` its class group's. */
  classGroups: z.array(
    z.object({
      id: z.string().uuid(),
      classGroupId: z.string().uuid(),
      code: z.string(),
      teacherName: z.string(),
      courseId: z.string().uuid(),
      academicPeriodId: z.string().uuid(),
      courseName: z.string(),
      academicPeriodName: z.string(),
      schedule: z.string(),
      slots: z.array(WeeklySlotSchema),
      startsOn: z.string().nullable(),
      endsOn: z.string().nullable(),
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
    summary: "Module runs an enrollment can be moved to, and the plans of their courses",
    description:
      "Every live module run (OOC-156) of every running class group (enrolling or in progress, nothing retired) except the run the enrollment is in — the other runs of its own class group included — full ones included with their class group's seat counters, and the live plans of those courses with the price in force.",
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
    summary: "Move an enrollment to another module run (OOC-84, OOC-156)",
    description:
      "Staff tool, free of charge: the payment never changes. classGroupModuleId names the run: of another class group (the seat moves) or of the same one (only the run changes). Another course requires planId (a live plan of that course; the enrollment takes its price in force). A full target is 422 enrollment.class_group_full unless allowOverCapacity is true (OOC-155). With placement \"schedule\" (OOC-145) the run stands for its offer (same course, period, dates, module and week): a run of the enrollment's own class group first, then the others in code order, above capacity only when all are full; the response names where the seat landed. Refusals: 422 enrollment.move_<seat_released|graded|same_class_group|target_unavailable|plan_required|plan_not_of_course|plan_not_allowed|reason_required>; 409 enrollment.move_conflict when the enrollment changed meanwhile.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .body(
    z.object({
      classGroupModuleId: z.string().uuid(),
      planId: z.string().uuid().nullable().default(null),
      allowOverCapacity: z.boolean().default(false),
      reason: z.string().max(MOVE_REASON_MAX_LENGTH * 2),
      // "schedule": the run names the hour and module, the API picks the
      // class group (OOC-145). Absent: exactly that run.
      placement: z.enum(SEAT_PLACEMENTS).default("class_group"),
    }),
  )
  .response(
    200,
    z.object({
      enrollmentId: z.string().uuid(),
      classGroupId: z.string().uuid(),
      classGroupModuleId: z.string().uuid(),
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
