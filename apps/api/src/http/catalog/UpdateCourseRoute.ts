import { UpdateCourseSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_OWNER_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Renaming or re-identifying a course rewrites what students enrolled in, so
 * it belongs to whoever may create one. Coordination's day-to-day changes go
 * through PATCH /catalog/courses/:id/options.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const updateCourseRoute = RouteBuilder.patch("/catalog/courses/:id")
  .docs({ tags: ["Catalog"], summary: "Edit a course (identity and options)" })
  .roles(...CATALOG_OWNER_ROLES)
  .params(IdParamsSchema)
  .body(UpdateCourseSchema.omit({ language: true }).refine((patch) => Object.keys(patch).length > 0))
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const course = await container.useCases.catalog.updateCourse.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      patch: request.body,
    });
    reply.status(200).send({ id: course.id });
  });
