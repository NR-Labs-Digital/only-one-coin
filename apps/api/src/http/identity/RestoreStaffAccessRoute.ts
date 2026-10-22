import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RestoreStaffAccessParamsSchema = z.object({
  userId: z.string().min(1),
});

// Admin-only.
export const restoreStaffAccessRoute = RouteBuilder.post("/staff/:userId/access/restore")
  .docs({
    tags: ["Identity"],
    summary: "Restore a panel account's access",
  })
  .roles("master", "admin")
  .params(RestoreStaffAccessParamsSchema)
  .response(204, z.void())
  .response(403, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.restoreAccess.run({
      actorId: request.currentUser!.id,
      targetUserId: request.params.userId,
    });

    reply.status(204).send();
  });
