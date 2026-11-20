import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { REPORT_DIMENSIONS } from "@/infra/persistence/report/assembleReport.js";
import { REPORT_READ_ROLES } from "./reportRoles.js";

const GetReportQuerySchema = z.object({
  // A period id or `all`; absent opens on the current period.
  period: z.union([z.literal("all"), z.string().uuid()]).optional(),
  dimension: z.enum(REPORT_DIMENSIONS).default("course"),
});

const LabelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name"), name: z.string() }),
  z.object({ kind: z.literal("no_teacher") }),
]);

const PeriodSchema = z.object({ id: z.string().uuid(), name: z.string() });
const RankedSchema = z.object({ key: z.string(), name: z.string(), count: z.number().int() });

const GetReportResponseSchema = z.object({
  refreshedAt: z.string().nullable(),
  periods: z.array(PeriodSchema),
  periodId: z.string().uuid().nullable(),
  dimension: z.enum(REPORT_DIMENSIONS),
  rows: z.array(
    z.object({
      key: z.string(),
      label: LabelSchema,
      sublabel: z.string().nullable(),
      enrollments: z.number().int(),
      reserved: z.number().int(),
      collectedCents: z.number().int(),
      pendingCents: z.number().int(),
      seatsTaken: z.number().int(),
      capacity: z.number().int(),
      classGroups: z.number().int(),
    }),
  ),
  totals: z.object({
    enrollments: z.number().int(),
    reserved: z.number().int(),
    collectedCents: z.number().int(),
    pendingCents: z.number().int(),
    pendingCount: z.number().int(),
    seatsTaken: z.number().int(),
    capacity: z.number().int(),
    classGroups: z.number().int(),
  }),
  months: z.array(z.object({ month: z.string(), enrollments: z.number().int(), collectedCents: z.number().int() })),
  trend: z.object({
    periods: z.array(PeriodSchema),
    series: z.array(z.object({ key: z.string(), label: LabelSchema, values: z.array(z.number().int()) })),
  }),
  rankings: z.object({ volume: z.array(RankedSchema), lowGrades: z.array(RankedSchema) }),
});

export const getReportRoute = RouteBuilder.get("/reports")
  .docs({
    tags: ["Reports"],
    summary: "Enrollments, money and occupancy, by course, language or teacher",
    description:
      "Backs /backoffice/reports (OOC-40). Read from the nightly aggregation, never from the ledger live — `refreshedAt` says when it was built (null: never). Definitions in ReportFactsRefresher.",
  })
  .roles(...REPORT_READ_ROLES)
  .query(GetReportQuerySchema)
  .response(200, GetReportResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const report = await container.queries.report.run(request.query);
    reply.status(200).send({ ...report, refreshedAt: report.refreshedAt?.toISOString() ?? null });
  });
