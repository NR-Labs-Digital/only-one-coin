import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/** Renaming never touches the price. No rate limit yet (docs/ROADMAP.md Sessão 25). */
export const renamePlanRoute = RouteBuilder.patch("/catalog/plans/:id")
  .docs({ tags: ["Catalog"], summary: "Rename a plan" })
  .can("catalog.courses_create")
  .params(IdParamsSchema)
  .body(z.object({ name: z.string().trim().min(1) }))
  .response(200, IdResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const plan = await container.useCases.catalog.renamePlan.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      name: request.body.name,
    });
    reply.status(200).send({ id: plan.id });
  });
