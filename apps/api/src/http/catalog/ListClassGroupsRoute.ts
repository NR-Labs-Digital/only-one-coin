import { ClassGroupStatusSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_READ_ROLES } from "./catalogRoles.js";
import { ClassGroupItemSchema } from "./CatalogSchemas.js";

const ListClassGroupsQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  status: ClassGroupStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  /** Only the class groups still waiting for a teacher from the roster (OOC-80). */
  unassigned: z.enum(["true"]).optional(),
});

// No rate limit yet (docs/ROADMAP.md Sessão 25).
export const listClassGroupsRoute = RouteBuilder.get("/catalog/class-groups")
  .docs({
    tags: ["Catalog"],
    summary: "List class groups for the backoffice",
    description:
      "Retired class groups included and flagged. Without a periodId and without a search term the answer is capped at the 500 most recent.",
  })
  .roles(...CATALOG_READ_ROLES)
  .query(ListClassGroupsQuerySchema)
  .response(200, z.object({ items: z.array(ClassGroupItemSchema) }))
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { unassigned, ...filter } = request.query;
    reply
      .status(200)
      .send({ items: await container.queries.listClassGroups.run({ ...filter, unassigned: unassigned === "true" }) });
  });
