import { PaymentMethodSchema, SEAT_PLACEMENTS } from "@ooc/domain";
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { MANUAL_ENROLLMENT_ROLES } from "./manualEnrollmentRoles.js";

const CreateManualEnrollmentBodySchema = z
  .object({
    studentId: z.string().uuid(),
    classGroupId: z.string().uuid(),
    planId: z.string().uuid(),
    method: PaymentMethodSchema,
    methodDetail: z.string().min(1).nullable(),
    operationNumber: z.string().min(1),
    // Mandatory since OOC-146: the receipt this same account uploaded and
    // confirmed through /enrollments/receipt-uploads.
    receiptUploadId: z.string().uuid(),
    // The staff member confirmed enrolling above capacity (OOC-155). Absent
    // or false, a full class group is 422 enrollment.class_group_full, as
    // before; the screen asks and sends it on the second try.
    allowOverCapacity: z.boolean().default(false),
    // "schedule": classGroupId names the hour, and the seat goes to the first
    // class group of it with room (OOC-145). Absent: exactly that class group.
    placement: z.enum(SEAT_PLACEMENTS).default("class_group"),
  })
  .refine((body) => body.method !== "other" || body.methodDetail !== null, {
    message: "methodDetail is required when method is 'other'",
    path: ["methodDetail"],
  });

const CreateManualEnrollmentResponseSchema = z.object({
  enrollment: z.object({
    id: z.string().uuid(),
    studentId: z.string().uuid(),
    classGroupId: z.string().uuid(),
    planPriceId: z.string().uuid(),
    seatStatus: z.enum(["reserved", "confirmed", "released"]),
    overCapacity: z.boolean(),
  }),
  payment: z.object({
    id: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    status: z.enum(["pending", "under_review", "approved", "rejected"]),
    method: PaymentMethodSchema,
    methodDetail: z.string().nullable(),
    amountCents: z.number().int(),
    operationNumber: z.string().nullable(),
  }),
});

// management + enrollment supervision only — the manual backoffice enrollment exception
// (CLAUDE.md §1, "/backoffice/enrollments"). Never touches money: billing
// settles payments elsewhere.
export const createManualEnrollmentRoute = RouteBuilder.post("/enrollments")
  .docs({
    tags: ["Enrollments"],
    summary: "Open an enrollment from the backoffice over an existing student",
    description:
      "The manual exception — the documented path is the student enrolling through the public form. Seat is always reserved, payment never starts approved, and the receipt is mandatory: it goes up the same OCR ladder and review queue as the checkout's. A receipt that is not this account's confirmed, unattached upload is 422 enrollment.receipt_not_ready. A full class group is 422 enrollment.class_group_full unless allowOverCapacity is true, in which case the seat is taken above capacity (OOC-155). With placement \"schedule\" (OOC-145), classGroupId names the hour: the seat goes to the first class group of its offer with room, in code order, and above capacity only when all of them are full; the response names the class group it landed in.",
  })
  .roles(...MANUAL_ENROLLMENT_ROLES)
  .body(CreateManualEnrollmentBodySchema)
  .response(201, CreateManualEnrollmentResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.enrollment.createManual.run({
      ...request.body,
      actorId: request.currentUser!.id,
    });
    reply.status(201).send(result);
  });
