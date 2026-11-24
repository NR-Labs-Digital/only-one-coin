import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DateTimeSchema, IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

const UpdatePeriodBodySchema = z
  .object({
    name: z.string().trim().min(1),
    startsOn: DateTimeSchema,
    endsOn: DateTimeSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);

/**
 * Renames or re-dates a period; the dates are never cleared.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const updatePeriodRoute = RouteBuilder.patch("/catalog/periods/:id")
  .docs({ tags: ["Catalog"], summary: "Edit an academic period" })
  .can("catalog.periods")
  .params(IdParamsSchema)
  .body(UpdatePeriodBodySchema)
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { name, startsOn, endsOn } = request.body;
    const period = await container.useCases.catalog.updatePeriod.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      patch: {
        ...(name !== undefined && { name }),
        ...(startsOn !== undefined && { startsOn: new Date(startsOn) }),
        ...(endsOn !== undefined && { endsOn: new Date(endsOn) }),
      },
    });
    reply.status(200).send({ id: period.id });
  });
