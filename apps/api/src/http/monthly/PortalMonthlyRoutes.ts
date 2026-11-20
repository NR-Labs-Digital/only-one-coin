import { RECEIPT_CONTENT_TYPES } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/*
 * Buying monthly modules from the portal (OOC-86). The account is always the
 * session's; an enrollment it does not reach answers like one that does not
 * exist (CLAUDE.md §8). Same three steps as a procedure's receipt: a signed
 * upload target, the confirm, and the payment.
 */

const EnrollmentParamsSchema = z.object({ enrollmentId: z.string().uuid() });

export const requestMonthlyReceiptUploadRoute = RouteBuilder.post("/portal/enrollments/:enrollmentId/monthly-receipt-uploads")
  .docs({
    tags: ["Portal"],
    summary: "Mint a signed upload target for a monthly module receipt",
    description: "The portal POSTs the file straight to the bucket; validation and normalization happen in the worker.",
  })
  .roles("student")
  .params(EnrollmentParamsSchema)
  .body(z.object({ contentType: z.enum(RECEIPT_CONTENT_TYPES) }))
  .response(201, z.object({
    receiptUploadId: z.string().uuid(),
    uploadUrl: z.string(),
    uploadFields: z.record(z.string(), z.string()),
    maxBytes: z.number().int(),
  }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.monthly.requestReceiptUpload.run({
      userId: request.currentUser!.id,
      enrollmentId: request.params.enrollmentId,
      contentType: request.body.contentType,
    });
    reply.status(201).send({
      receiptUploadId: result.receiptUploadId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });

export const confirmMonthlyReceiptUploadRoute = RouteBuilder.post(
  "/portal/enrollments/:enrollmentId/monthly-receipt-uploads/:receiptUploadId/confirm",
)
  .docs({ tags: ["Portal"], summary: "Confirm the portal's direct-to-bucket upload of a monthly receipt landed" })
  .roles("student")
  .params(z.object({ enrollmentId: z.string().uuid(), receiptUploadId: z.string().uuid() }))
  .body(z.object({}))
  .response(200, z.object({ receiptUploadId: z.string().uuid() }))
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.monthly.confirmReceiptUpload.run({
      userId: request.currentUser!.id,
      enrollmentId: request.params.enrollmentId,
      receiptUploadId: request.params.receiptUploadId,
    });
    reply.status(200).send(result);
  });

export const submitMonthlyPaymentRoute = RouteBuilder.post("/portal/enrollments/:enrollmentId/monthly-payment")
  .docs({
    tags: ["Portal"],
    summary: "Buy the next monthly module(s) with one receipt: the payment is born pending",
    description:
      "`moduleCount` is how many of the modules for sale, from the first (always a prefix). No amount in the body: it is moduleCount times the module's price in force today. A person settles it in Payments.",
  })
  .roles("student")
  .params(EnrollmentParamsSchema)
  .body(z.object({
    receiptUploadId: z.string().uuid(),
    method: z.enum(["yape", "plin", "bcp", "interbank"]),
    operationNumber: z.string().trim().min(1).max(64),
    moduleCount: z.number().int().min(1).max(50),
    idempotencyKey: z.string().uuid(),
  }))
  .response(201, z.object({
    paymentId: z.string().uuid(),
    amountCents: z.number().int(),
    modules: z.array(z.object({ module: z.number().int(), attempt: z.number().int() })),
  }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.monthly.submitPayment.run({
      userId: request.currentUser!.id,
      enrollmentId: request.params.enrollmentId,
      ...request.body,
    });
    reply.status(201).send(result);
  });
