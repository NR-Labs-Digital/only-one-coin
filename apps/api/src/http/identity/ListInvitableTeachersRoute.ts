import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const InvitableTeacherSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

/**
 * The teacher picker of the staff invite form (OOC-79): active files with no
 * panel account and no invite already open. Gated like the invite itself —
 * opening a panel account is management's alone (CLAUDE.md §8) — and carries
 * only what fills the form: name and e-mail.
 */
export const listInvitableTeachersRoute = RouteBuilder.get("/staff/invites/teacher-options")
  .docs({ tags: ["Identity"], summary: "Teacher files that can still receive a panel account" })
  .roles("master", "admin")
  .response(200, z.object({ items: z.array(InvitableTeacherSchema) }))
  .handler(async (_request, reply) => {
    reply.status(200).send({ items: await container.queries.listInvitableTeachers.run() });
  });
