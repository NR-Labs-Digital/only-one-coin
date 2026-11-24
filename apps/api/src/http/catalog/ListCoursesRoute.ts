import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { CourseListItemSchema } from "./CatalogSchemas.js";

// No rate limit yet (docs/ROADMAP.md Sessão 25).
export const listCoursesRoute = RouteBuilder.get("/catalog/courses")
  .docs({
    tags: ["Catalog"],
    summary: "List courses for the backoffice",
    description: "Every course, retired ones included and flagged, with how many live class groups hang off each.",
  })
  .can("catalog.view")
  .response(200, z.object({ items: z.array(CourseListItemSchema) }))
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.listCourses.run() });
  });
