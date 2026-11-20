import { PaymentMethodSchema, ProcedureKindSchema, RECEIPT_VERDICTS } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { STUDENT_FILE_ROLES } from "./studentRoles.js";

const ResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      procedureKind: ProcedureKindSchema.nullable(),
      courseNames: z.array(z.string()),
      enrollmentCount: z.number().int(),
      status: z.enum(["pending", "under_review", "approved", "rejected"]),
      method: PaymentMethodSchema,
      methodDetail: z.string().nullable(),
      operationNumber: z.string().nullable(),
      amountCents: z.number().int(),
      expectedAmountCents: z.number().int(),
      readAmountCents: z.number().int().nullable(),
      verdict: z.enum(RECEIPT_VERDICTS).nullable(),
      rejectionReason: z.enum(["amount_mismatch", "illegible", "duplicate", "not_a_receipt", "other"]).nullable(),
      hasReceipt: z.boolean(),
      currency: z.literal("PEN"),
      submittedAt: z.string(),
      decidedAt: z.string().nullable(),
    }),
  ),
});

/**
 * The receipts block of the student file's Documents tab (OOC-62): every
 * payment the student sent a receipt for — enrollment, monthly module, paid
 * procedure, lot — in any state, newest first. Metadata only: the image
 * itself is still `GET /payments/:id/receipt`, with its own roles and its
 * audit entry. Read by whoever reads the file.
 */
export const listStudentPaymentsRoute = RouteBuilder.get("/students/:studentId/payments")
  .docs({
    tags: ["Students"],
    summary: "A student's payments and receipts",
    description:
      "Every payment on the student's file, with the declared, expected and read amounts, the traffic light and the decision. No image — that is GET /payments/:id/receipt.",
  })
  .roles(...STUDENT_FILE_ROLES)
  .params(z.object({ studentId: z.string().uuid() }))
  .response(200, ResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const rows = await container.queries.studentPayments.run(request.params.studentId);
    reply.status(200).send({
      items: rows.map((row) => ({
        ...row,
        currency: "PEN" as const,
        submittedAt: row.submittedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      })),
    });
  });
