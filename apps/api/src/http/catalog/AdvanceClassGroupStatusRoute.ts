import { ClassGroupStatusSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CLASS_GROUP_WRITE_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Moves a class group one step forward, by a person's decision. No step back.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const advanceClassGroupStatusRoute = RouteBuilder.post("/catalog/class-groups/:id/status")
  .docs({ tags: ["Catalog"], summary: "Advance a class group to its next status" })
  .roles(...CLASS_GROUP_WRITE_ROLES)
  .params(IdParamsSchema)
  .body(z.object({ to: ClassGroupStatusSchema }))
  .response(200, IdResponseSchema.extend({ status: ClassGroupStatusSchema }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const group = await container.useCases.catalog.advanceClassGroupStatus.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      to: request.body.to,
    });
    reply.status(200).send({ id: group.id, status: group.status });
  });
