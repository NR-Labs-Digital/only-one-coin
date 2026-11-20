import { PlanBillingSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_OWNER_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, PriceBodySchema } from "./CatalogSchemas.js";

/** A plan is born with its first price. No rate limit yet (docs/ROADMAP.md Sessão 25). */
export const createPlanRoute = RouteBuilder.post("/catalog/courses/:id/plans")
  .docs({ tags: ["Catalog"], summary: "Create a plan with its first price" })
  .roles(...CATALOG_OWNER_ROLES)
  .params(IdParamsSchema)
  .body(PriceBodySchema.extend({ name: z.string().trim().min(1), billing: PlanBillingSchema.optional() }))
  .response(201, z.object({ id: z.string().uuid(), priceId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { plan, price } = await container.useCases.catalog.createPlan.run({
      actorId: request.currentUser!.id,
      courseId: request.params.id,
      name: request.body.name,
      billing: request.body.billing,
      amountCents: request.body.amountCents,
      validFrom: request.body.validFrom ? new Date(request.body.validFrom) : undefined,
    });
    reply.status(201).send({ id: plan.id, priceId: price.id });
  });
