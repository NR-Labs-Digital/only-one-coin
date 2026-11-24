import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { PeriodListItemSchema } from "./CatalogSchemas.js";

// No rate limit yet (docs/ROADMAP.md Sessão 25).
export const listPeriodsRoute = RouteBuilder.get("/catalog/periods")
  .docs({
    tags: ["Catalog"],
    summary: "List academic periods for the backoffice",
    description: "Newest first, retired ones included and flagged, with how many live class groups each holds.",
  })
  .can("catalog.view")
  .response(200, z.object({ items: z.array(PeriodListItemSchema) }))
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.listPeriods.run() });
  });
