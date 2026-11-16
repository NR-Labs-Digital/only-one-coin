import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";
import { WeeklySlotSchema } from "./CatalogSchemas.js";

const OpenClassGroupResponseSchema = z.array(
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    courseId: z.string().uuid(),
    academicPeriodId: z.string().uuid(),
    courseName: z.string(),
    academicPeriodName: z.string(),
    schedule: z.string(),
    slots: z.array(WeeklySlotSchema),
    startsOn: z.string(),
    endsOn: z.string(),
    capacity: z.number().int(),
    seatsTaken: z.number().int(),
    seatsOver: z.number().int(),
    status: z.string(),
    planId: z.string().uuid(),
    planName: z.string(),
    planPriceId: z.string().uuid(),
    amountCents: z.number().int(),
  }),
);

// management + enrollment supervision only — same audience as the manual enrollment route this
// feeds (CLAUDE.md §1). No client input at all: this is a fixed, server-decided
// filter (on sale per sellableClassGroup; full ones included since OOC-155), so there's nothing to validate
// or bound beyond what the query itself already does.
export const listOpenClassGroupsRoute = RouteBuilder.get("/class-groups")
  .docs({
    tags: ["Catalog"],
    summary: "List class groups still open for enrollment",
    description: "Backs the manual enrollment form's class group picker.",
  })
  .roles("master", "admin", "enrollment_supervisor")
  .response(200, OpenClassGroupResponseSchema)
  .handler(async (_request, reply) => {
    const results = await container.queries.listOpenClassGroups.run();
    // jsonb comes back untyped; the response schema is what names its shape.
    reply.status(200).send(results.map((row) => ({ ...row, slots: row.slots as z.infer<typeof WeeklySlotSchema>[] })));
  });
