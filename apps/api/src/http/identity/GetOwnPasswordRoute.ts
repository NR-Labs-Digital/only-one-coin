import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

const GetOwnPasswordResponseSchema = z.object({
  changedAt: z.string().nullable(),
});

// Backs the "changed on …" line of the account screen. Same cargo list as
// GET /me — everyone with a panel account — and the same scope: the session's
// own user, never an id from the client.
export const getOwnPasswordRoute = RouteBuilder.get("/me/password")
  .docs({
    tags: ["Identity"],
    summary: "When the signed-in staff member's password last changed",
    description: "Null while it is still the password the account was created with.",
  })
  .roles(
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
  )
  .response(200, GetOwnPasswordResponseSchema)
  .handler(async (request, reply) => {
    const changedAt = await container.queries.getPasswordChangedAt.run(request.currentUser!.id);
    reply.status(200).send({ changedAt: changedAt?.toISOString() ?? null });
  });
