import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/**
 * The guardian accepts the consent text for one of their children (OOC-72) —
 * the way a file registered in the backoffice, born with consent pending,
 * gets it. The account is the session's; the profile only picks among its
 * own, and the usecase checks the account is the guardian on file. The IP is
 * the guardian's as the edge saw it (`infra/edge/clientIp.ts`), never a value
 * from the body.
 */
export const acceptGuardianConsentRoute = RouteBuilder.post("/portal/guardian-consents")
  .docs({
    tags: ["Portal"],
    summary: "The guardian accepts the consent text for a child",
    description: "Appends the Ley 29733 consent (version, date, IP) for the profile's live guardian. Accepting again is a no-op.",
  })
  .roles("student")
  .body(z.object({ profileId: z.string().uuid(), version: z.string().min(1).max(32) }))
  .response(200, z.object({ outcome: z.enum(["accepted", "already_accepted"]) }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.student.acceptGuardianConsent.run({
      userId: request.currentUser!.id,
      profileId: request.body.profileId,
      version: request.body.version,
      ip: request.clientIp,
    });
    reply.status(200).send(result);
  });
