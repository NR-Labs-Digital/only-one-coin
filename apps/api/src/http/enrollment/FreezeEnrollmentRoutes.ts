import { FREEZE_REASON_MAX_LENGTH } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { WeeklySlotSchema } from "@/http/catalog/CatalogSchemas.js";
import { MANUAL_ENROLLMENT_ROLES } from "./manualEnrollmentRoles.js";

const ParamsSchema = z.object({ id: z.string().uuid() });

// Freezing is a seat act, like moving one (OOC-84): the same three who open a
// manual enrollment and move it. Free of charge on the platform (decision of
// 20/11/2026) — the student's paid request goes through Payments instead.
export const freezeEnrollmentRoute = RouteBuilder.post("/enrollments/:id/freeze")
  .docs({
    tags: ["Enrollments"],
    summary: "Freeze an enrollment (OOC-84)",
    description:
      "The seat goes back to its class group, the enrollment is frozen at the module and attempt it is on. Only a confirmed seat, of a course that allows freezing, in a class group enrolling or in progress. Refusals: 422 enrollment.freeze_<seat_not_confirmed|course_disallows|class_group_not_running|reason_required>; 409 enrollment.freeze_conflict when it changed meanwhile.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .body(z.object({ reason: z.string().max(FREEZE_REASON_MAX_LENGTH * 2) }))
  .response(200, z.object({ freezeId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.freeze.run({
      actorId: request.currentUser!.id,
      enrollmentId: request.params.id,
      reason: request.body.reason,
    });
    reply.status(200).send(result);
  });

export const listFreezeReturnRunsRoute = RouteBuilder.get("/enrollments/:id/return-runs")
  .docs({
    tags: ["Enrollments"],
    summary: "The module runs a frozen enrollment can come back to",
    description:
      "Live runs of the enrollment's course and of the module it stopped in, in class groups enrolling or in progress, full ones included with their seat counters. 422 enrollment.return_not_frozen when it is not frozen.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .response(
    200,
    z.object({
      runs: z.array(
        z.object({
          id: z.string().uuid(),
          classGroupId: z.string().uuid(),
          code: z.string(),
          module: z.number().int().nullable(),
          startsOn: z.string().nullable(),
          slots: z.array(WeeklySlotSchema),
          capacity: z.number().int(),
          seatsTaken: z.number().int(),
        }),
      ),
    }),
  )
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const runs = await container.useCases.enrollment.listReturnRuns.run({ enrollmentId: request.params.id });
    reply.status(200).send({
      runs: runs.map((run) => ({
        id: run.id,
        classGroupId: run.classGroupId,
        code: run.code,
        module: run.module,
        startsOn: run.startsOn ? run.startsOn.toISOString() : null,
        // jsonb comes back untyped; the response schema names its shape.
        slots: run.slots as z.infer<typeof WeeklySlotSchema>[],
        capacity: run.capacity,
        seatsTaken: run.seatsTaken,
      })),
    });
  });

export const returnFromFreezeRoute = RouteBuilder.post("/enrollments/:id/return")
  .docs({
    tags: ["Enrollments"],
    summary: "Bring a frozen enrollment back to the module it stopped in (OOC-84)",
    description:
      "classGroupModuleId is a run of the same course and module, in a class group enrolling or in progress. A full one is 422 enrollment.class_group_full unless allowOverCapacity is true (OOC-155). Refusals: 422 enrollment.return_<not_frozen|target_unavailable>; 409 enrollment.freeze_conflict.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .params(ParamsSchema)
  .body(z.object({ classGroupModuleId: z.string().uuid(), allowOverCapacity: z.boolean().default(false) }))
  .response(200, z.object({ overCapacity: z.boolean() }))
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.returnFromFreeze.run({
      actorId: request.currentUser!.id,
      enrollmentId: request.params.id,
      ...request.body,
    });
    reply.status(200).send(result);
  });
