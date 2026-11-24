import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const CancelStaffInviteParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

// Admin-only. Withdraws the invite before the person ever completed it — the
// link stops resolving once the row is no longer `pending`
// (GetStaffInviteRoute / CompleteStaffInviteRoute both check status).
export const cancelStaffInviteRoute = RouteBuilder.post("/staff/invites/:inviteId/cancel")
  .docs({
    tags: ["Identity"],
    summary: "Cancel a pending invite",
  })
  .can("team.invite")
  .params(CancelStaffInviteParamsSchema)
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.cancelInvite.run({
      actorId: request.currentUser!.id,
      inviteId: request.params.inviteId,
    });

    reply.status(204).send();
  });
