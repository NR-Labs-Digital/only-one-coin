import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { splitName } from "@/infra/identity/splitName.js";

const StaffRoleSchema = z.enum([
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
]);

const GetCurrentStaffResponseSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: StaffRoleSchema,
  teacherId: z.string().uuid().nullable(),
});

// The signed-in staff member's own identity, read from the session Better
// Auth already resolved (`request.currentUser`, populated by
// `authorizationPlugin` from the session cookie — never from client input,
// CLAUDE.md §8). No usecase behind this: it reshapes an already-authorized
// read for the client, it does not touch persistence or enforce a business
// rule.
//
// `teacherId` is always null for now — the `teachers` table exists (OOC-77),
// but nothing links a panel account to a teacher record yet (OOC-80). A
// `teacher` account still authenticates and reaches this route; the panel just
// cannot narrow it to "their own class groups" until that link exists.
export const getCurrentStaffRoute = RouteBuilder.get("/me")
  .docs({
    tags: ["Identity"],
    summary: "Get the signed-in staff member's own identity",
    description: "Backs the backoffice shell's role gating and account chip.",
  })
  .roles(
    "master",
    "admin",
    "analyst",
    "enrollment_supervisor",
    "academic_supervisor",
    "teacher",
    "sales",
    "support",
    "billing",
  )
  .response(200, GetCurrentStaffResponseSchema)
  .handler(async (request, reply) => {
    // The authorization plugin's onRequest hook always sets this before a
    // non-public handler runs — narrowed here only so TypeScript knows it.
    const user = request.currentUser!;
    const { firstName, lastName } = splitName(user.name);

    reply.status(200).send({
      id: user.id,
      firstName,
      lastName,
      email: user.email,
      role: user.role as z.infer<typeof StaffRoleSchema>,
      teacherId: null,
    });
  });
