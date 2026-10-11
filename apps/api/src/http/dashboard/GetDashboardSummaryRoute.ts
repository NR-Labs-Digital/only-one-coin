import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { CATALOG_READ_ROLES } from "@/http/catalog/catalogRoles.js";

const DashboardSummaryResponseSchema = z.object({
  enrollmentsToday: z.number().int(),
  enrollmentsYesterday: z.number().int(),
  activeStudents: z.number().int(),
  activeStudentsYesterday: z.number().int(),
});

// The same people who read the enrollment ledger and the catalog: these are
// those two lists counted. Billing sees no academic data (CLAUDE.md §8), and
// a teacher has a home of their own.
export const getDashboardSummaryRoute = RouteBuilder.get("/dashboard/summary")
  .docs({
    tags: ["Dashboard"],
    summary: "The backoffice home's enrollment and active-student figures",
    description:
      "Enrollments confirmed today and students studying now, each next to yesterday's figure (Lima time). Definitions in DashboardSummaryQuery.",
  })
  .roles(...CATALOG_READ_ROLES)
  .response(200, DashboardSummaryResponseSchema)
  .handler(async (_request, reply) => {
    const summary = await container.queries.dashboardSummary.run();
    reply.status(200).send(summary);
  });
