import { ClassGroupStatusSchema } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { CreateClassGroupBodySchema, IdResponseSchema, toDate } from "./CatalogSchemas.js";

/**
 * Opens a class group as a draft, or straight into enrolling when `publish`
 * is true (refused while it lacks dates).
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const createClassGroupRoute = RouteBuilder.post("/catalog/class-groups")
  .docs({ tags: ["Catalog"], summary: "Create a class group" })
  .can("catalog.class_groups_edit")
  .body(CreateClassGroupBodySchema)
  .response(201, IdResponseSchema.extend({ status: ClassGroupStatusSchema }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { publish, startsOn, endsOn, enrollmentOpensAt, enrollmentClosesAt, ...rest } = request.body;
    const group = await container.useCases.catalog.createClassGroup.run({
      actorId: request.currentUser!.id,
      classGroup: {
        ...rest,
        startsOn: toDate(startsOn),
        endsOn: toDate(endsOn),
        enrollmentOpensAt: toDate(enrollmentOpensAt),
        enrollmentClosesAt: toDate(enrollmentClosesAt),
      },
      publish,
    });
    reply.status(201).send({ id: group.id, status: group.status });
  });
