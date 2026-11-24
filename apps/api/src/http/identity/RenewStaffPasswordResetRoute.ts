import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RenewStaffPasswordResetParamsSchema = z.object({
  resetId: z.string().uuid(),
});

const RenewStaffPasswordResetResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

// Admin-only.
export const renewStaffPasswordResetRoute = RouteBuilder.post("/staff/password-resets/:resetId/renew")
  .docs({
    tags: ["Identity"],
    summary: "Renew an expired or expiring password-reset link",
  })
  .can("team.access")
  .params(RenewStaffPasswordResetParamsSchema)
  .response(200, RenewStaffPasswordResetResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { reset } = await container.useCases.staff.renewPasswordReset.run({
      resetId: request.params.resetId,
    });

    reply.status(200).send({ token: reset.token, expiresAt: reset.expiresAt.toISOString() });
  });
