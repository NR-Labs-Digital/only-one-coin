import { DEFAULT_LOCALE, LocaleSchema, MAX_EMAIL_PROOF_RECIPIENTS } from "@ooc/domain";
import { z } from "zod";
import { container } from "@/container.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";
import { EMAIL_PROOF_ROLES } from "./emailRoles.js";
import { EmittedEmailKeySchema } from "./emailFlowSchemas.js";
import { EMAIL_PREVIEW_SAMPLES } from "./emailPreviewSamples.js";

// "Send a proof" on an automatic e-mail's page (OOC-89): the repository's
// template over the preview's sample data, to up to five addresses, subject
// marked. Written to the outbox, so the staging allowlist applies to it like
// to every other e-mail (CLAUDE.md §6).
export const sendEmailProofRoute = RouteBuilder.post("/emails/flows/:key/proof")
  .docs({
    tags: ["Emails"],
    summary: "Send a proof of an automatic e-mail over sample data",
    description:
      "Up to five addresses, in one language. Proof rows go through the outbox and are left out of the e-mail figures and the resend list.",
  })
  .roles(...EMAIL_PROOF_ROLES)
  .rateLimit(RATE_LIMITS.staff, RATE_LIMITS.emailProof)
  .params(z.object({ key: EmittedEmailKeySchema }))
  .body(
    z.object({
      locale: LocaleSchema.default(DEFAULT_LOCALE),
      recipients: z.array(z.string().trim().max(254)).min(1).max(MAX_EMAIL_PROOF_RECIPIENTS),
    }),
  )
  .response(202, z.object({ sent: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { key } = request.params;
    const { outboxIds } = await container.useCases.emails.sendProof.run({
      actorId: request.currentUser!.id,
      templateKey: key,
      locale: request.body.locale,
      recipients: request.body.recipients,
      vars: EMAIL_PREVIEW_SAMPLES[key] as Record<string, unknown>,
    });
    reply.status(202).send({ sent: outboxIds.length });
  });
