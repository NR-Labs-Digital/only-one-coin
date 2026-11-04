import { ProcedureKindSchema, RECEIPT_CONTENT_TYPES } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/*
 * What a signed-in student does to pay for a procedure (OOC-83). The account is
 * always the session's; every id in the URL or the body is compared against it
 * in the usecase, and someone else's answers like one that does not exist
 * (CLAUDE.md §8).
 */

const RequestParamsSchema = z.object({ requestId: z.string().uuid() });

export const openProcedureRequestRoute = RouteBuilder.post("/portal/procedure-requests")
  .docs({
    tags: ["Portal"],
    summary: "Ask for a paid procedure on one of the student's enrollments",
    description: "Freezes the price in force. Asking again while the first request waits for its receipt returns that request.",
  })
  .roles("student")
  .body(z.object({ kind: ProcedureKindSchema, enrollmentId: z.string().uuid() }))
  .response(201, z.object({ id: z.string().uuid(), amountCents: z.number().int() }))
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.procedure.openRequest.run({
      userId: request.currentUser!.id,
      kind: request.body.kind,
      enrollmentId: request.body.enrollmentId,
    });
    reply.status(201).send({ id: result.id, amountCents: result.amountCents });
  });

export const requestProcedureReceiptUploadRoute = RouteBuilder.post("/portal/procedure-requests/:requestId/receipt-uploads")
  .docs({
    tags: ["Portal"],
    summary: "Mint a signed upload target for a procedure's receipt",
    description: "The portal POSTs the file straight to the bucket; validation and normalization happen in the worker, as in the checkout.",
  })
  .roles("student")
  .params(RequestParamsSchema)
  .body(z.object({ contentType: z.enum(RECEIPT_CONTENT_TYPES) }))
  .response(201, z.object({
    receiptUploadId: z.string().uuid(),
    uploadUrl: z.string(),
    uploadFields: z.record(z.string(), z.string()),
    maxBytes: z.number().int(),
  }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.procedure.requestReceiptUpload.run({
      userId: request.currentUser!.id,
      requestId: request.params.requestId,
      contentType: request.body.contentType,
    });
    reply.status(201).send({
      receiptUploadId: result.receiptUploadId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });

export const confirmProcedureReceiptUploadRoute = RouteBuilder.post("/portal/procedure-requests/:requestId/receipt-uploads/:receiptUploadId/confirm")
  .docs({ tags: ["Portal"], summary: "Confirm the portal's direct-to-bucket upload landed" })
  .roles("student")
  .params(z.object({ requestId: z.string().uuid(), receiptUploadId: z.string().uuid() }))
  .body(z.object({}))
  .response(200, z.object({ receiptUploadId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.procedure.confirmReceiptUpload.run({
      userId: request.currentUser!.id,
      requestId: request.params.requestId,
      receiptUploadId: request.params.receiptUploadId,
    });
    reply.status(200).send(result);
  });

export const submitProcedurePaymentRoute = RouteBuilder.post("/portal/procedure-requests/:requestId/payment")
  .docs({
    tags: ["Portal"],
    summary: "Send a procedure's receipt: the payment is born pending",
    description: "No amount in the body: the payment is for what the request froze. A person settles it in Payments.",
  })
  .roles("student")
  .params(RequestParamsSchema)
  .body(z.object({
    receiptUploadId: z.string().uuid(),
    method: z.enum(["yape", "plin", "bcp", "interbank"]),
    operationNumber: z.string().trim().min(1).max(64),
    idempotencyKey: z.string().uuid(),
  }))
  .response(201, z.object({ paymentId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.procedure.submitPayment.run({
      userId: request.currentUser!.id,
      requestId: request.params.requestId,
      ...request.body,
    });
    reply.status(201).send(result);
  });
