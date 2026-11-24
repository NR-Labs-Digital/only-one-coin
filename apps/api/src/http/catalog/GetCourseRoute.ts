import { CourseNotFoundError } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CourseListItemSchema, IdParamsSchema, PlanDetailSchema } from "./CatalogSchemas.js";

export const getCourseRoute = RouteBuilder.get("/catalog/courses/:id")
  .docs({ tags: ["Catalog"], summary: "One course with its plans and price history" })
  .can("catalog.view")
  .params(IdParamsSchema)
  .response(200, z.object({ course: CourseListItemSchema, plans: z.array(PlanDetailSchema) }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const detail = await container.queries.getCourse.run(request.params.id);
    if (!detail) throw new CourseNotFoundError();
    reply.status(200).send(detail);
  });
