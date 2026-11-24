import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { IdParamsSchema, WaitlistItemSchema } from "./CatalogSchemas.js";

/**
 * Each row carries the student's national id, so only who runs class groups
 * reads it — the same people GET /students shows the DNI to, not the whole
 * catalog readership.
 */
// No rate limit yet (docs/ROADMAP.md Sessão 25).
export const listWaitlistRoute = RouteBuilder.get("/catalog/class-groups/:id/waitlist")
  .docs({ tags: ["Catalog"], summary: "Who is waiting for a class group", description: "First come first served." })
  .can("catalog.waitlist")
  .params(IdParamsSchema)
  .response(200, z.object({ items: z.array(WaitlistItemSchema) }))
  .handler(async (request, reply) => {
    reply.status(200).send({ items: await container.queries.listWaitlist.run(request.params.id) });
  });
