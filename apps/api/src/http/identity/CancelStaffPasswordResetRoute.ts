import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const CancelStaffPasswordResetParamsSchema = z.object({
  resetId: z.string().uuid(),
});

// Admin-only.
export const cancelStaffPasswordResetRoute = RouteBuilder.post("/staff/password-resets/:resetId/cancel")
  .docs({
    tags: ["Identity"],
    summary: "Cancel a pending password-reset link",
  })
  .can("team.access")
  .params(CancelStaffPasswordResetParamsSchema)
  .response(204, z.void())
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.cancelPasswordReset.run({ resetId: request.params.resetId });
    reply.status(204).send();
  });
