import { LocaleSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";

const StartOwnMfaEnrollmentBodySchema = z.object({
  /** The language of the screen asking — the e-mail is written in it. */
  locale: LocaleSchema,
});

// First half of turning the second factor on: e-mails a code to the account's
// own address. Reachable before the factor is on — it is how it gets on.
export const startOwnMfaEnrollmentRoute = RouteBuilder.post("/me/mfa/enrollment")
  .docs({
    tags: ["Identity"],
    summary: "E-mail a code to turn on the signed-in staff member's second factor",
    description: "Asking again replaces the code. 409 when the factor is already on.",
  })
  .can("account.self")
  .allowBeforeMfa()
  .rateLimit(RATE_LIMITS.staff, RATE_LIMITS.staffMfaSend)
  .body(StartOwnMfaEnrollmentBodySchema)
  .response(204, z.null())
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.startOwnMfaEnrollment.run({
      userId: request.currentUser!.id,
      sessionToken: request.sessionToken!,
      locale: request.body.locale,
    });

    reply.status(204).send();
  });
