import { z } from "zod";
import { CreateCourseSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Opens a course from another one (OOC-182). The same permission as opening a
 * course — it is one, started from a filled-in form. The landing page is not
 * in the body: the copy is born unlinked (one live course per page, OOC-117).
 */
export const duplicateCourseRoute = RouteBuilder.post("/catalog/courses/:id/duplicate")
  .docs({ tags: ["Catalog"], summary: "Create a course from another one, with copies of its plans" })
  .can("catalog.courses_create")
  .params(IdParamsSchema)
  .body(
    CreateCourseSchema.omit({ language: true, languageId: true, landingKey: true }).extend({
      languageId: z.string().uuid(),
      plans: z
        .array(
          z.object({
            sourcePlanId: z.string().uuid(),
            name: z.string().trim().min(1),
            amountCents: z.number().int().positive(),
          }),
        )
        .max(50),
    }),
  )
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { plans, ...course } = request.body;
    const created = await container.useCases.catalog.duplicateCourse.run({
      actorId: request.currentUser!.id,
      sourceCourseId: request.params.id,
      course,
      plans,
    });
    reply.status(201).send({ id: created.id });
  });
