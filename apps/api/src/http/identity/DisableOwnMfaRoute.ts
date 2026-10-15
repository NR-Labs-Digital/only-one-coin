import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STAFF_MFA_ROLES } from "./staffMfaRoles.js";

const DisableOwnMfaBodySchema = z.object({
  password: z.string().min(1),
});

// Every cargo may call it; master, admin and billing are refused by the
// usecase (403 staff_mfa.required_for_role) — for them there is no switch
// (CLAUDE.md §8). The role is the session's, read from the database.
export const disableOwnMfaRoute = RouteBuilder.post("/me/mfa/disable")
  .docs({
    tags: ["Identity"],
    summary: "Turn off the signed-in staff member's second factor",
    description: "Requires the current password. Refused for the cargos that must keep it.",
  })
  .roles(...STAFF_MFA_ROLES)
  .body(DisableOwnMfaBodySchema)
  .response(204, z.null())
  .response(403, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    await container.useCases.staff.disableOwnMfa.run({
      userId: user.id,
      role: user.role,
      password: request.body.password,
    });

    reply.status(204).send();
  });
