import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema } from "@/http/catalog/CatalogSchemas.js";
import { serializeTeachingClassGroup, TeachingClassGroupSchema } from "./teachingSchemas.js";

// The id in the URL says what is asked for; whose it is comes from the session
// and is compared in the usecase. Another teacher's answers 404 (anti-IDOR).
export const getOwnClassGroupRoute = RouteBuilder.get("/teaching/class-groups/:id")
  .docs({
    tags: ["Teaching"],
    summary: "One of the signed-in teacher's class groups",
    description: "Somebody else's, a closed one and one that does not exist all answer the same 404.",
  })
  .roles("teacher")
  .params(IdParamsSchema)
  .response(200, TeachingClassGroupSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const group = await container.useCases.teaching.getOwnClassGroup.run({
      userId: request.currentUser!.id,
      classGroupId: request.params.id,
    });
    reply.status(200).send(serializeTeachingClassGroup(group));
  });
