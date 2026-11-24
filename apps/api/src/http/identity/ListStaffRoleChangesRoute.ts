import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const StaffRoleSchema = z.enum([
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "academic_assistant",
  "teacher",
  "sales",
  "support",
  "billing",
  "custom",
]);

const StaffRoleChangeSchema = z.object({
  id: z.string(),
  at: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  fromRole: StaffRoleSchema.nullable(),
  toRole: StaffRoleSchema,
  fromProfileName: z.string().nullable(),
  toProfileName: z.string().nullable(),
  actorName: z.string(),
  actorRole: StaffRoleSchema,
  actorProfileName: z.string().nullable(),
});

const ListStaffRoleChangesResponseSchema = z.object({
  items: z.array(StaffRoleChangeSchema),
});

// Admin-only, same audience as the directory it explains (CLAUDE.md §8).
export const listStaffRoleChangesRoute = RouteBuilder.get("/staff/role-changes")
  .docs({
    tags: ["Identity"],
    summary: "List the cargo ledger",
    description: "Backs Equipo's role-change history — reads audit_log, never edits it.",
  })
  .can("team.view")
  .response(200, ListStaffRoleChangesResponseSchema)
  .handler(async (_request, reply) => {
    const items = await container.queries.listStaffRoleChanges.run();

    reply.status(200).send({
      items: items.map((row) => ({ ...row, at: row.at.toISOString() })),
    });
  });
