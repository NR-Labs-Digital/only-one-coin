import { z } from "zod";
import { CatalogClassGroupNotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_READ_ROLES } from "./catalogRoles.js";
import { IdParamsSchema } from "./CatalogSchemas.js";

const MonthlyRowSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  classGroupModuleId: z.string().uuid(),
  module: z.number().int().nullable(),
  attempt: z.number().int(),
  state: z.enum(["paid", "in_review", "due", "unknown"]),
  dueSince: z.string().nullable(),
  aheadModules: z.array(z.number().int()),
});

// The monthly seats of a class group (OOC-86): who is up to date, who has a
// receipt in review, who owes the module they are on and since when. The same
// readers as the roster, and only what the roster already shows them — name
// and payment standing, never the student file.
export const getClassGroupMonthlyRoute = RouteBuilder.get("/catalog/class-groups/:id/monthly")
  .docs({
    tags: ["Catalog"],
    summary: "Where each monthly seat of a class group stands on its current module",
    description: "Confirmed seats of monthly plans only, every module group, ordered by surname.",
  })
  .roles(...CATALOG_READ_ROLES)
  .params(IdParamsSchema)
  .response(200, z.object({ items: z.array(MonthlyRowSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const rows = await container.queries.classGroupMonthly.run(request.params.id);
    if (!rows) throw new CatalogClassGroupNotFoundError();
    reply.status(200).send({
      items: rows.map(({ firstName, lastName, dueSince, ...row }) => ({
        ...row,
        studentName: `${firstName} ${lastName}`,
        dueSince: dueSince ? dueSince.toISOString() : null,
      })),
    });
  });
