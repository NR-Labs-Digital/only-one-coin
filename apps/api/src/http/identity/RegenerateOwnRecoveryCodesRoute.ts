import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STAFF_MFA_ROLES } from "./staffMfaRoles.js";

const RegenerateOwnRecoveryCodesBodySchema = z.object({
  password: z.string().min(1),
});

const RegenerateOwnRecoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

// A new set of recovery codes; the old set stops working. Asks for the
// password again — a recovery code is a way past the e-mail code.
export const regenerateOwnRecoveryCodesRoute = RouteBuilder.post("/me/mfa/recovery-codes")
  .docs({
    tags: ["Identity"],
    summary: "Issue a new set of recovery codes for the signed-in staff member",
    description: "Requires the current password. Voids every code issued before.",
  })
  .roles(...STAFF_MFA_ROLES)
  .body(RegenerateOwnRecoveryCodesBodySchema)
  .response(200, RegenerateOwnRecoveryCodesResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.staff.regenerateOwnRecoveryCodes.run({
      userId: request.currentUser!.id,
      password: request.body.password,
    });

    reply.status(200).send(result);
  });
