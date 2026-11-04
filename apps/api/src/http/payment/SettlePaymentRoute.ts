import { PaymentRejectionReasonSchema } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { PAYMENT_SETTLE_ROLES } from "./paymentRoles.js";

const ParamsSchema = z.object({ id: z.string().uuid() });
const ResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected"]),
  // Null for a procedure's payment: it has no seat to move (OOC-83).
  seatStatus: z.enum(["reserved", "confirmed", "released"]).nullable(),
  portalAccess: z.enum(["created", "linked_existing", "already_linked", "email_conflict"]).nullable(),
});

/** Approving finishes the enrollment — the seat is confirmed (OOC-55) — or frees
 * a paid procedure to run (OOC-83). */
export const approvePaymentRoute = RouteBuilder.post("/payments/:id/approve")
  .docs({ tags: ["Payments"], summary: "Approve a payment: confirms its enrollment or pays its procedure" })
  .roles(...PAYMENT_SETTLE_ROLES)
  .params(ParamsSchema)
  .body(z.object({}))
  .response(200, ResultSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.payment.settlePayment.run({
      actorId: request.currentUser!.id,
      paymentId: request.params.id,
      decision: { kind: "approve" },
    });
    reply.status(200).send({ id: result.paymentId, status: result.status, seatStatus: result.seatStatus, portalAccess: result.portalAccess });
  });

/** Rejecting hands an enrollment's seat back to the class group, or ends a
 * procedure's request. A procedure never touches a seat. */
export const rejectPaymentRoute = RouteBuilder.post("/payments/:id/reject")
  .docs({ tags: ["Payments"], summary: "Reject a payment: releases its seat or ends its procedure request" })
  .roles(...PAYMENT_SETTLE_ROLES)
  .params(ParamsSchema)
  .body(z.object({ reason: PaymentRejectionReasonSchema, note: z.string().trim().max(500) }))
  .response(200, ResultSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.payment.settlePayment.run({
      actorId: request.currentUser!.id,
      paymentId: request.params.id,
      decision: { kind: "reject", reason: request.body.reason, note: request.body.note },
    });
    reply.status(200).send({ id: result.paymentId, status: result.status, seatStatus: result.seatStatus, portalAccess: result.portalAccess });
  });
