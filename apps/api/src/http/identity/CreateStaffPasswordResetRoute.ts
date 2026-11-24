import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const CreateStaffPasswordResetParamsSchema = z.object({
  userId: z.string().min(1),
});

const CreateStaffPasswordResetResponseSchema = z.object({
  resetId: z.string(),
  token: z.string(),
  expiresAt: z.string(),
});

// Admin-only. Same shape as inviting somebody, for the same operational
// reason: an admin generates a one-time link and sends it by hand — this
// time to an account that already exists and just needs a new password.
export const createStaffPasswordResetRoute = RouteBuilder.post("/staff/:userId/password-reset")
  .docs({
    tags: ["Identity"],
    summary: "Generate a password-reset link for a panel account",
    description: "One-time, 24h link — admin copies it and sends it by hand, same as an invite.",
  })
  .can("team.access")
  .params(CreateStaffPasswordResetParamsSchema)
  .response(201, CreateStaffPasswordResetResponseSchema)
  .handler(async (request, reply) => {
    const { reset } = await container.useCases.staff.createPasswordReset.run({
      actorId: request.currentUser!.id,
      targetUserId: request.params.userId,
    });

    reply.status(201).send({
      resetId: reset.id,
      token: reset.token,
      expiresAt: reset.expiresAt.toISOString(),
    });
  });
