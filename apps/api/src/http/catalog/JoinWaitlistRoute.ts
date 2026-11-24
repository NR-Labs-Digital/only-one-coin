import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Staff queues a student on a full class group.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const joinWaitlistRoute = RouteBuilder.post("/catalog/class-groups/:id/waitlist")
  .docs({ tags: ["Catalog"], summary: "Put a student on a class group's waitlist" })
  .can("catalog.waitlist")
  .params(IdParamsSchema)
  .body(z.object({ studentId: z.string().uuid() }))
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const entry = await container.useCases.catalog.joinWaitlist.run({
      actorId: request.currentUser!.id,
      classGroupId: request.params.id,
      studentId: request.body.studentId,
    });
    reply.status(201).send({ id: entry.id });
  });
