import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const GetOwnMfaResponseSchema = z.object({
  enabled: z.boolean(),
  /** The cargo cannot turn it off (CLAUDE.md §8) — and cannot use the panel until it is on. */
  required: z.boolean(),
  recoveryCodesLeft: z.number().int(),
  /** The cargo may tick "remember this browser" at the sign-in code (OOC-154) — exactly when the factor is optional. */
  trustBrowserAvailable: z.boolean(),
  /** Browsers that skip the code today; the account screen offers to forget them. */
  trustedBrowsers: z.number().int(),
});

// Backs the account screen's second-factor card and the sign-in flow's
// "turn it on now" step — so it is reachable before the factor is on.
export const getOwnMfaRoute = RouteBuilder.get("/me/mfa")
  .docs({
    tags: ["Identity"],
    summary: "The signed-in staff member's second-factor state",
    description: "Whether it is on, whether the cargo requires it, and how many recovery codes are left.",
  })
  .can("account.self")
  .allowBeforeMfa()
  .response(200, GetOwnMfaResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    const [state, trustedBrowsers] = await Promise.all([
      container.identity.staffSecondFactor.state(user.id),
      container.identity.staffTrustedBrowsers.count(user.id),
    ]);
    const required = container.identity.staffAccess.requiresMfa(user);

    reply.status(200).send({ ...state, required, trustBrowserAvailable: !required, trustedBrowsers });
  });
