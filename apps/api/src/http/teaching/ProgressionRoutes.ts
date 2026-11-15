import type { Role, ProgressionPreview } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { ClassGroupModuleParamsSchema, IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";

/**
 * Who moves students on from the backoffice (OOC-156, decision of 14/11/2026
 * — to confirm with the owner): management and both supervisions. The
 * teacher does it from the portal, in their own run only, never below the
 * pass mark while it is required.
 */
export const PROGRESSION_ROLES = [
  "master",
  "admin",
  "enrollment_supervisor",
  "academic_supervisor",
] as const satisfies readonly Role[];

const ProgressionPreviewSchema = z.object({
  classGroupId: z.string().uuid(),
  classGroupModuleId: z.string().uuid(),
  module: z.number().int().nullable(),
  next: z.object({ id: z.string().uuid(), module: z.number().int() }).nullable(),
  lastModule: z.boolean(),
  passingGrade: z.number().int(),
  requiresPassingGrade: z.boolean(),
  seats: z.array(
    z.object({
      enrollmentId: z.string().uuid(),
      firstName: z.string(),
      lastName: z.string(),
      attempt: z.number().int(),
      grade: z.number().nullable(),
      didNotSit: z.boolean(),
      verdict: z.enum(["passed", "below_passing", "did_not_sit", "not_graded"]),
    }),
  ),
});

function serializePreview(preview: ProgressionPreview): z.infer<typeof ProgressionPreviewSchema> {
  return {
    ...preview,
    seats: preview.seats.map((seat) => ({
      enrollmentId: seat.enrollmentId,
      firstName: seat.firstName,
      lastName: seat.lastName,
      attempt: seat.attempt,
      grade: seat.grade?.kind === "score" ? seat.grade.score : null,
      didNotSit: seat.grade?.kind === "did_not_sit",
      verdict: seat.verdict,
    })),
  };
}

const ApplyBodySchema = z.object({
  advance: z.array(z.string().uuid()).max(500).default([]),
  repeat: z.array(z.string().uuid()).max(500).default([]),
  reason: z.string().max(1000).nullable().default(null),
});

const ApplyResponseSchema = z.object({ advanced: z.number().int(), repeated: z.number().int() });

const APPLY_DESCRIPTION =
  "Advances seats to the next module's run of the same class group, or has them repeat the module in the same run (a new attempt). Refusals: 422 teaching.progression_<closed|empty|unknown_enrollment|duplicate_enrollment|not_graded|no_next_run|below_passing|reason_required>; 409 teaching.progression_conflict when a seat changed meanwhile.";

export const previewOwnProgressionRoute = RouteBuilder.get("/teaching/class-groups/:id/progression")
  .docs({ tags: ["Teaching"], summary: "Who of the teacher's own run may move on, and to which run (OOC-156)" })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, ProgressionPreviewSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const preview = await container.useCases.teaching.previewOwnProgression.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send(serializePreview(preview));
  });

export const applyOwnProgressionRoute = RouteBuilder.post("/teaching/class-groups/:id/progression")
  .docs({ tags: ["Teaching"], summary: "Move the students of the teacher's own run on (OOC-156)", description: APPLY_DESCRIPTION })
  .roles("teacher")
  .params(IdParamsSchema)
  .body(ApplyBodySchema)
  .response(200, ApplyResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.applyOwnProgression.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
      advance: request.body.advance,
      repeat: request.body.repeat,
    });
    reply.status(200).send(result);
  });

export const previewProgressionRoute = RouteBuilder.get("/catalog/class-groups/:id/modules/:moduleId/progression")
  .docs({ tags: ["Teaching"], summary: "Who of a module run may move on, and to which run (OOC-156)" })
  .roles(...PROGRESSION_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .response(200, ProgressionPreviewSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const preview = await container.useCases.teaching.previewProgression.run({
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
    });
    reply.status(200).send(serializePreview(preview));
  });

export const applyProgressionRoute = RouteBuilder.post("/catalog/class-groups/:id/modules/:moduleId/progression")
  .docs({
    tags: ["Teaching"],
    summary: "Move the students of a module run on — below the pass mark too, with a reason (OOC-156)",
    description: APPLY_DESCRIPTION,
  })
  .roles(...PROGRESSION_ROLES)
  .params(ClassGroupModuleParamsSchema)
  .body(ApplyBodySchema)
  .response(200, ApplyResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.teaching.applyProgression.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      classGroupModuleId: request.params.moduleId,
      advance: request.body.advance,
      repeat: request.body.repeat,
      reason: request.body.reason,
    });
    reply.status(200).send(result);
  });
