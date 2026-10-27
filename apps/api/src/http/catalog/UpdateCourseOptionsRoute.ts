import { CourseOptionsSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_WRITE_ROLES } from "./catalogRoles.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Coordination's day-to-day: age, load, certificate rule, procedures, and the
 * material link of each module (OOC-94). Applies to class groups opened
 * afterwards.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const updateCourseOptionsRoute = RouteBuilder.patch("/catalog/courses/:id/options")
  .docs({ tags: ["Catalog"], summary: "Change a course's options" })
  .roles(...CATALOG_WRITE_ROLES)
  .params(IdParamsSchema)
  .body(CourseOptionsSchema.partial().refine((patch) => Object.keys(patch).length > 0))
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const course = await container.useCases.catalog.updateCourse.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      patch: request.body,
    });
    reply.status(200).send({ id: course.id });
  });
