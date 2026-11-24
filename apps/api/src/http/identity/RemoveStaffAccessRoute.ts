import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RemoveStaffAccessParamsSchema = z.object({
  userId: z.string().min(1),
});

// Admin-only. Not a delete: whoever approved a payment or signed a grade
// stays pointed at by those rows (CLAUDE.md §6). Better Auth's own sign-in
// hook (admin plugin) is what actually locks the account out once this runs.
export const removeStaffAccessRoute = RouteBuilder.post("/staff/:userId/access/remove")
  .docs({
    tags: ["Identity"],
    summary: "Remove a panel account's access",
  })
  .can("team.access")
  .params(RemoveStaffAccessParamsSchema)
  .response(204, z.void())
  .response(403, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.removeAccess.run({
      actorId: request.currentUser!.id,
      targetUserId: request.params.userId,
    });

    reply.status(204).send();
  });
