import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema } from "./CatalogSchemas.js";

/**
 * Copies a period's live class groups into this one as empty drafts. The
 * path id is the TARGET; the source travels in the body.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const duplicatePeriodRoute = RouteBuilder.post("/catalog/periods/:id/duplicate")
  .docs({
    tags: ["Catalog"],
    summary: "Copy another period's class groups into this period",
    description: "Drafts with no dates and no seats taken. A second copy of the same source answers 409.",
  })
  .can("catalog.periods")
  .params(IdParamsSchema)
  .body(z.object({ sourcePeriodId: z.string().uuid() }))
  .response(201, z.object({ copied: z.number().int(), skippedRetired: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.catalog.duplicatePeriod.run({
      actorId: request.currentUser!.id,
      sourcePeriodId: request.body.sourcePeriodId,
      targetPeriodId: request.params.id,
    });
    reply.status(201).send(result);
  });
