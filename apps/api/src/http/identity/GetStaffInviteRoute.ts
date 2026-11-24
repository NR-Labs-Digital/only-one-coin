import { z } from "zod";
import { NotFoundError } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const GetStaffInviteParamsSchema = z.object({
  token: z.string().min(1),
});

const GetStaffInviteResponseSchema = z.object({
  firstName: z.string(),
  email: z.string(),
  role: z.enum([
    "master",
    "admin",
    "analyst",
    "enrollment_supervisor",
    "academic_supervisor",
    "academic_assistant",
    "teacher",
    "sales",
    "support",
    "billing",
  ]),
  status: z.enum(["pending", "completed", "cancelled"]),
  expiresAt: z.string(),
});

// Public — the whole point of an invite link is that the person opening it
// has no session yet (CLAUDE.md §8, "sem auto-cadastro" for the equivalent
// student case, same reasoning). Backs the completion screen's prefetch: it
// only ever reads a token from the URL, never a client-supplied identity.
export const getStaffInviteRoute = RouteBuilder.get("/staff/invites/:token")
  .docs({
    tags: ["Identity"],
    summary: "Resolve an invite by its token",
    description: "Backs /backoffice/invite/[token] before it renders the completion form.",
  })
  .public()
  .rateLimit(RATE_LIMITS.staffLink)
  .params(GetStaffInviteParamsSchema)
  .response(200, GetStaffInviteResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const invite = await container.repositories.staffInvite.findByToken(request.params.token);

    if (!invite) {
      throw new NotFoundError({ reason: "staff_invite.not_found", message: "No invite with this token.", path: request.url });
    }

    reply.status(200).send({
      firstName: invite.firstName,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });
