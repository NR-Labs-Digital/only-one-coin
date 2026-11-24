import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/**
 * The portal account corrects the phone of a profile it reaches (OOC-110).
 * The account is the session's; the profile only picks among its own, with
 * no fallback (someone else's file is 404). The phone is held to the same
 * rule as registration (`PhoneField`); the audit line names the field only.
 */
export const updateOwnPhoneRoute = RouteBuilder.patch("/portal/me/phone")
  .docs({
    tags: ["Portal"],
    summary: "Correct the phone of one of the account's profiles",
    description: "Rewrites the phone on the profile's file. Name, document, birth date and e-mail stay a staff correction.",
  })
  .roles("student")
  .body(z.object({ profileId: z.string().uuid(), phone: z.string().max(200) }))
  .response(200, z.object({ phone: z.string() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.student.updateOwnPhone.run({
      userId: request.currentUser!.id,
      profileId: request.body.profileId,
      phone: request.body.phone,
    });
    reply.status(200).send(result);
  });
