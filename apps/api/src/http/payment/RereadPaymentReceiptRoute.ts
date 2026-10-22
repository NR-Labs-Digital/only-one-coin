import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { PAYMENT_SETTLE_ROLES } from "./paymentRoles.js";

/**
 * Asks for a new reading of the payment's latest receipt (ROADMAP Sessão 32).
 * Records the request and answers 202 — the model is called by the
 * `receipt-reread` worker, never here (apps/api/CLAUDE.md, "OCR — nunca
 * síncrono"). Only who settles money may ask: a reading costs a model call,
 * and it is their decision it informs. The payment's status never moves.
 */
export const rereadPaymentReceiptRoute = RouteBuilder.post("/payments/:id/reread")
  .docs({
    tags: ["Payments"],
    summary: "Queue a new OCR reading of a payment's receipt",
    description:
      "One pending re-read per receipt. The new reading and its traffic-light verdict show up in GET /payments/review once the worker answers; the payment's status is never changed. Written to the audit log.",
  })
  .roles(...PAYMENT_SETTLE_ROLES)
  .params(z.object({ id: z.string().uuid() }))
  .body(z.object({}))
  .response(202, z.object({ rereadId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.payment.requestReceiptReread.run({
      actorId: request.currentUser!.id,
      paymentId: request.params.id,
    });
    reply.status(202).send({ rereadId: result.rereadId });
  });
