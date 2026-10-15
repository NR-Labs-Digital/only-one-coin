import { requiresMfa } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { STAFF_MFA_ROLES } from "./staffMfaRoles.js";

const GetOwnMfaResponseSchema = z.object({
  enabled: z.boolean(),
  /** The cargo cannot turn it off (CLAUDE.md §8) — and cannot use the panel until it is on. */
  required: z.boolean(),
  recoveryCodesLeft: z.number().int(),
});

// Backs the account screen's second-factor card and the sign-in flow's
// "turn it on now" step — so it is reachable before the factor is on.
export const getOwnMfaRoute = RouteBuilder.get("/me/mfa")
  .docs({
    tags: ["Identity"],
    summary: "The signed-in staff member's second-factor state",
    description: "Whether it is on, whether the cargo requires it, and how many recovery codes are left.",
  })
  .roles(...STAFF_MFA_ROLES)
  .allowBeforeMfa()
  .response(200, GetOwnMfaResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    const state = await container.identity.staffSecondFactor.state(user.id);

    reply.status(200).send({ ...state, required: requiresMfa(user.role) });
  });
