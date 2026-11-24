import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

export const getPaymentReceiptRoute = RouteBuilder.get("/payments/:id/receipt")
  .docs({
    tags: ["Payments"],
    summary: "Get a 5-minute URL for a payment's processed receipt",
    description: "The only way a person sees a receipt image. Every call is written to the audit log.",
  })
  .can("payments.view_receipt")
  .params(z.object({ id: z.string().uuid() }))
  .response(200, z.object({ url: z.string().url(), expiresAt: z.string() }))
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.queries.paymentReceiptImage.run({
      paymentId: request.params.id,
      actorId: request.currentUser!.id,
    });
    reply.status(200).send({ url: result.url, expiresAt: result.expiresAt.toISOString() });
  });
