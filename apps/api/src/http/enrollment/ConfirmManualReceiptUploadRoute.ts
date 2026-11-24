import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

export const confirmManualReceiptUploadRoute = RouteBuilder.post("/enrollments/receipt-uploads/:receiptUploadId/confirm")
  .docs({
    tags: ["Enrollments"],
    summary: "Confirm a manual enrollment's direct-to-bucket upload landed",
    description:
      "A metadata-only HEAD against the bucket. Only the account that started the upload confirms it; anyone else's answers 404.",
  })
  .can("enrollments.create_manual")
  .params(z.object({ receiptUploadId: z.string().uuid() }))
  .response(200, z.object({ receiptUploadId: z.string().uuid() }))
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.confirmManualReceiptUpload.run({
      actorId: request.currentUser!.id,
      receiptUploadId: request.params.receiptUploadId,
    });

    reply.status(200).send(result);
  });
