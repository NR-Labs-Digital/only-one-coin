import { RECEIPT_CONTENT_TYPES } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { MANUAL_ENROLLMENT_ROLES } from "./manualEnrollmentRoles.js";

const ReceiptUploadResponseSchema = z.object({
  receiptUploadId: z.string().uuid(),
  uploadUrl: z.string(),
  uploadFields: z.record(z.string(), z.string()),
  maxBytes: z.number().int(),
});

export const requestManualReceiptUploadRoute = RouteBuilder.post("/enrollments/receipt-uploads")
  .docs({
    tags: ["Enrollments"],
    summary: "Mint a signed upload target for a manual enrollment's receipt",
    description:
      "The receipt is mandatory on the manual enrollment (OOC-146). The browser POSTs the file straight to the bucket; the upload belongs to the signed-in staff account until POST /enrollments attaches it to the payment.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .body(z.object({ contentType: z.enum(RECEIPT_CONTENT_TYPES) }))
  .response(201, ReceiptUploadResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.requestManualReceiptUpload.run({
      actorId: request.currentUser!.id,
      contentType: request.body.contentType,
    });

    reply.status(201).send({
      receiptUploadId: result.receiptUploadId,
      uploadUrl: result.upload.url,
      uploadFields: result.upload.fields,
      maxBytes: result.maxBytes,
    });
  });
