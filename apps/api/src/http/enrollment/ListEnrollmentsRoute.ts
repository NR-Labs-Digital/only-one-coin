import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const EnrollmentListRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  studentId: z.string().uuid(),
  studentName: z.string(),
  courseName: z.string(),
  classGroupId: z.string().uuid().nullable(),
  classGroupName: z.string(),
  teacherName: z.string(),
  language: z.object({ id: z.string(), name: z.string() }).nullable(),
  modality: z.literal("online"),
  academicPeriodName: z.string(),
  status: z.enum(["under_review", "active", "completed", "rejected"]),
  seatStatus: z.enum(["reserved", "confirmed", "released"]),
  planName: z.string(),
  planPriceId: z.string().uuid(),
  amountCents: z.number().int(),
  currency: z.literal("PEN"),
  paymentStatus: z.enum(["pending", "under_review", "approved", "rejected"]),
  paymentMethod: z.enum(["yape", "plin", "bcp", "interbank", "other"]),
  paymentMethodDetail: z.string().nullable(),
  operationNumber: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  progressPct: z.number().nullable(),
});

const EnrollmentListResponseSchema = z.object({
  items: z.array(EnrollmentListRowSchema),
  metrics: z.object({
    periodName: z.string(),
    total: z.number().int(),
    active: z.number().int(),
    reserved: z.number().int(),
    expiringSoon: z.number().int(),
    released: z.number().int(),
  }),
  truncated: z.boolean(),
});

// Who reads the ledger, matching the screen's own gate
// (`canBrowseEnrollments`, apps/app/src/lib/backoffice/permissions.ts): the
// enrollment side owns it, management sees everything, the analyst observes,
// and sales/support answer for the enrollments people ask them about
// (CLAUDE.md §8). `billing` settles money in Pagos and a teacher reaches their
// students through the class group — neither reads a roster of the whole
// institution.
export const listEnrollmentsRoute = RouteBuilder.get("/enrollments")
  .docs({
    tags: ["Enrollments"],
    summary: "List the enrollment ledger",
    description:
      "Backs /backoffice/enrollments. Newest first, capped — `truncated` says whether the ledger holds more.",
  })
  .roles("master", "admin", "enrollment_supervisor", "analyst", "sales", "support")
  .response(200, EnrollmentListResponseSchema)
  .handler(async (_request, reply) => {
    const result = await container.queries.listEnrollments.run();

    reply.status(200).send({
      items: result.items.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      })),
      metrics: result.metrics,
      truncated: result.truncated,
    });
  });
