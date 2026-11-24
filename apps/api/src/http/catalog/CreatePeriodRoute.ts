import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { DateTimeSchema, IdResponseSchema } from "./CatalogSchemas.js";

const CreatePeriodBodySchema = z.object({
  name: z.string().trim().min(1),
  startsOn: DateTimeSchema,
  endsOn: DateTimeSchema,
});

/**
 * Opens a sales period (OOC-35).
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const createPeriodRoute = RouteBuilder.post("/catalog/periods")
  .docs({ tags: ["Catalog"], summary: "Create an academic period" })
  .can("catalog.periods")
  .body(CreatePeriodBodySchema)
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const period = await container.useCases.catalog.createPeriod.run({
      actorId: request.currentUser!.id,
      period: {
        name: request.body.name,
        startsOn: new Date(request.body.startsOn),
        endsOn: new Date(request.body.endsOn),
      },
    });
    reply.status(201).send({ id: period.id });
  });
