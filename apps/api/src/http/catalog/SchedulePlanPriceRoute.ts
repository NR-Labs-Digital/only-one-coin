import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, PriceBodySchema } from "./CatalogSchemas.js";

/**
 * A new price is always a new row — correcting a price is scheduling another
 * one (CLAUDE.md §5). No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const schedulePlanPriceRoute = RouteBuilder.post("/catalog/plans/:id/prices")
  .docs({ tags: ["Catalog"], summary: "Schedule a new price for a plan" })
  .can("catalog.plan_prices")
  .params(IdParamsSchema)
  .body(PriceBodySchema)
  .response(201, z.object({ id: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const price = await container.useCases.catalog.schedulePlanPrice.run({
      actorId: request.currentUser!.id,
      planId: request.params.id,
      amountCents: request.body.amountCents,
      validFrom: request.body.validFrom ? new Date(request.body.validFrom) : undefined,
    });
    reply.status(201).send({ id: price.id });
  });
