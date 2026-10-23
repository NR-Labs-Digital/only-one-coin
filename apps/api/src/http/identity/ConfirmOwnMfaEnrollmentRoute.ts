import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { container } from "@/container.js";
import { STAFF_MFA_ROLES } from "./staffMfaRoles.js";

const ConfirmOwnMfaEnrollmentBodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});

const ConfirmOwnMfaEnrollmentResponseSchema = z.object({
  /** Shown once — the platform never shows them again. */
  recoveryCodes: z.array(z.string()),
});

// Second half: the code e-mailed by /me/mfa/enrollment turns the factor on.
// Better Auth replaces the session when it does, so the new session cookie
// goes back with the answer — without it the next request would be signed out.
export const confirmOwnMfaEnrollmentRoute = RouteBuilder.post("/me/mfa/enrollment/confirm")
  .docs({
    tags: ["Identity"],
    summary: "Turn on the signed-in staff member's second factor with the e-mailed code",
    description:
      "Answers the recovery codes, once, and the replaced session cookie. 422 when the code is wrong, expired or tried too many times.",
  })
  .roles(...STAFF_MFA_ROLES)
  .allowBeforeMfa()
  .rateLimit(RATE_LIMITS.staff, RATE_LIMITS.staffMfaConfirm)
  .body(ConfirmOwnMfaEnrollmentBodySchema)
  .response(200, ConfirmOwnMfaEnrollmentResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.staff.confirmOwnMfaEnrollment.run({
      userId: request.currentUser!.id,
      sessionToken: request.sessionToken!,
      code: request.body.code,
    });

    reply.header("set-cookie", result.sessionCookies);
    reply.status(200).send({ recoveryCodes: result.recoveryCodes });
  });
