import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const ForgetOwnTrustedBrowsersResponseSchema = z.object({
  forgotten: z.number().int(),
});

// "Forget remembered browsers" on the account screen (OOC-154). Every cargo
// may call it, even one that can no longer be remembered — a browser trusted
// before a promotion is still a row worth clearing. The user is the session's.
export const forgetOwnTrustedBrowsersRoute = RouteBuilder.post("/me/mfa/trusted-browsers/forget")
  .docs({
    tags: ["Identity"],
    summary: "Forget every browser the signed-in staff member asked to remember",
    description: "The next sign-in from any of them asks for the e-mailed code again.",
  })
  .can("account.self")
  .response(200, ForgetOwnTrustedBrowsersResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    const result = await container.useCases.staff.forgetOwnTrustedBrowsers.run({ userId: user.id });

    reply.status(200).send(result);
  });
