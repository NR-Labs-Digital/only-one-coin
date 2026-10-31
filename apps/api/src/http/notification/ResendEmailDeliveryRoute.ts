import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { EMAIL_DELIVERY_RESEND_ROLES } from "./emailDeliveryRoles.js";

// "Resend" on the undelivered e-mails screen (OOC-90): an audited exception
// (docs/DOCUMENTOS-E-CERTIFICADOS.md §4). A new outbox row, never the failed
// one moved back to pending.
export const resendEmailDeliveryRoute = RouteBuilder.post("/emails/deliveries/:outboxId/resend")
  .docs({
    tags: ["E-mails"],
    summary: "Send a failed e-mail again",
    description:
      "Writes a new outbox row to the address on the file today, and the audit entry, together. 409 when the row is not failed or was already resent; 422 for an e-mail whose one-time link is gone.",
  })
  .roles(...EMAIL_DELIVERY_RESEND_ROLES)
  .params(z.object({ outboxId: z.string().uuid() }))
  .body(z.object({}))
  .response(202, z.object({ outboxId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.emails.resendDelivery.run({
      actorId: request.currentUser!.id,
      outboxId: request.params.outboxId,
    });
    reply.status(202).send(result);
  });
