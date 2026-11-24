import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const StaffMemberSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: z.enum([
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
  ]),
  /** The cargo created in Equipo, for a `custom` account or invite (OOC-183). */
  profileId: z.string().nullable(),
  profileName: z.string().nullable(),
  /** Whether the account's cargo must sign in with the second factor (CLAUDE.md §8). */
  mfaRequired: z.boolean(),
  status: z.enum(["active", "invited", "inactive"]),
  teacherId: z.string().nullable(),
  mfaEnrolled: z.boolean(),
  joinedAt: z.string(),
  lastAccessAt: z.string().nullable(),
  inviteToken: z.string().nullable(),
  inviteExpiresAt: z.string().nullable(),
});

const ListStaffResponseSchema = z.object({
  items: z.array(StaffMemberSchema),
});

// Admin-only — the team directory is where a cargo changes (CLAUDE.md §8).
export const listStaffRoute = RouteBuilder.get("/staff")
  .docs({
    tags: ["Identity"],
    summary: "List panel accounts and pending invites",
    description: "Backs the Equipo directory — real accounts plus invites still waiting on the person.",
  })
  .can("team.view")
  .response(200, ListStaffResponseSchema)
  .handler(async (_request, reply) => {
    const items = await container.queries.listStaff.run();

    reply.status(200).send({
      items: items.map((row) => ({
        ...row,
        role: row.role as z.infer<typeof StaffMemberSchema>["role"],
        mfaRequired: container.identity.staffAccess.requiresMfa({
          role: row.role as z.infer<typeof StaffMemberSchema>["role"],
          profileId: row.profileId,
        }),
        joinedAt: row.joinedAt.toISOString(),
        lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
        inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
      })),
    });
  });
