import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const EnrollmentStatusSchema = z.enum(["under_review", "active", "completed", "rejected"]);
const SeatStatusSchema = z.enum(["reserved", "confirmed", "released"]);

// Every filter the ledger screen offers, applied by Postgres. Absent means
// "all", except the tab, which opens on who is studying now (OOC-115). `q` keeps the same floor as the student search, so a one-letter
// query does not turn into a full-ledger ILIKE on every keystroke.
const ListEnrollmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  state: z.enum(["current", "ended", "all"]).default("current"),
  language: z.string().trim().min(1).max(100).optional(),
  period: z.string().uuid().optional(),
  q: z.string().trim().min(2).max(100).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

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
  classGroupStatus: z.enum(["draft", "enrolling", "in_progress", "finished", "closed"]),
  status: EnrollmentStatusSchema,
  seatStatus: SeatStatusSchema,
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
  // Matching the filters, across every page.
  total: z.number().int(),
  counts: z.object({ current: z.number().int(), ended: z.number().int(), all: z.number().int() }),
  page: z.number().int(),
  pageSize: z.number().int(),
  metrics: z.object({
    periodName: z.string(),
    total: z.number().int(),
    active: z.number().int(),
  }),
  filterOptions: z.object({
    languages: z.array(z.string()),
    periods: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  }),
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
      "Backs /backoffice/enrollments. Opens on the current tab (class group enrolling or in progress); `counts` says how many each tab holds under the other filters. One page at a time, filtered and searched server-side; the metrics count the whole ledger.",
  })
  .roles("master", "admin", "enrollment_supervisor", "analyst", "sales", "support")
  .query(ListEnrollmentsQuerySchema)
  .response(200, EnrollmentListResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { page, state, language, period, q, sort } = request.query;
    const result = await container.queries.listEnrollments.run({
      page,
      state: state === "all" ? undefined : state,
      language,
      academicPeriodId: period,
      q,
      sort,
    });

    reply.status(200).send({
      items: result.items.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      })),
      total: result.total,
      counts: result.counts,
      page: result.page,
      pageSize: result.pageSize,
      metrics: result.metrics,
      filterOptions: result.filterOptions,
    });
  });
