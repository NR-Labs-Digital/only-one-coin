import { StaffWaitlistLeaveReasonSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, IdResponseSchema } from "./CatalogSchemas.js";

/**
 * Staff takes a student out of a waitlist. 'enrolled' is never a reason
 * here: the manual enrollment writes it.
 * No rate limit yet (docs/ROADMAP.md Sessão 25).
 */
export const leaveWaitlistRoute = RouteBuilder.post("/catalog/waitlist/:id/leave")
  .docs({ tags: ["Catalog"], summary: "Take a student out of a waitlist" })
  .can("catalog.waitlist")
  .params(IdParamsSchema)
  .body(z.object({ reason: StaffWaitlistLeaveReasonSchema }))
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const entry = await container.useCases.catalog.leaveWaitlist.run({
      actorId: request.currentUser!.id,
      entryId: request.params.id,
      reason: request.body.reason,
    });
    reply.status(200).send({ id: entry.id });
  });
