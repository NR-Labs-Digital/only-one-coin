import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RenewStaffInviteParamsSchema = z.object({
  inviteId: z.string().uuid(),
});

const RenewStaffInviteResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

// Admin-only. Same token, new expiry — the invite screen's "copiar el
// enlace" stays valid for the same link (CLAUDE.md decision recorded on
// staff_invites.token, packages/db/src/schema.ts).
export const renewStaffInviteRoute = RouteBuilder.post("/staff/invites/:inviteId/renew")
  .docs({
    tags: ["Identity"],
    summary: "Renew an expired or expiring invite",
    description: "Extends the invite's expiry without changing its token.",
  })
  .can("team.invite")
  .params(RenewStaffInviteParamsSchema)
  .response(200, RenewStaffInviteResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { invite } = await container.useCases.staff.renewInvite.run({
      actorId: request.currentUser!.id,
      inviteId: request.params.inviteId,
    });

    reply.status(200).send({ token: invite.token, expiresAt: invite.expiresAt.toISOString() });
  });
