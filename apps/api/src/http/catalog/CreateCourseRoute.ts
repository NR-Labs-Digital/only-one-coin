import { z } from "zod";
import { CreateCourseSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CATALOG_OWNER_ROLES } from "./catalogRoles.js";
import { IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Opens a course (OOC-36). Management only: the whole catalog, the price
 * table and every future class group hang off it.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const createCourseRoute = RouteBuilder.post("/catalog/courses")
  .docs({ tags: ["Catalog"], summary: "Create a course" })
  .roles(...CATALOG_OWNER_ROLES)
  // The language is picked from the list by id (OOC-128); its name is the record's.
  .body(CreateCourseSchema.omit({ language: true }).extend({ languageId: z.string().uuid() }))
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const course = await container.useCases.catalog.createCourse.run({
      actorId: request.currentUser!.id,
      course: request.body,
    });
    reply.status(201).send({ id: course.id });
  });
