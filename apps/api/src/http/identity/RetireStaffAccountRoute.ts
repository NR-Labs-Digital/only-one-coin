import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const RetireStaffAccountParamsSchema = z.object({
  userId: z.string().min(1),
});

const RetireStaffAccountBodySchema = z.object({
  confirmEmail: z.string().min(1).max(320),
});

// Same cargos as removing access. Not a delete: the row stays for whatever
// points at it (RetireStaffAccountUseCase).
export const retireStaffAccountRoute = RouteBuilder.post("/staff/:userId/retire")
  .docs({
    tags: ["Identity"],
    summary: "Retire a panel account, confirmed by typing its e-mail",
  })
  .roles("master", "admin")
  .params(RetireStaffAccountParamsSchema)
  .body(RetireStaffAccountBodySchema)
  .response(204, z.void())
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.staff.retireAccount.run({
      actorId: request.currentUser!.id,
      actorRole: request.currentUser!.role,
      targetUserId: request.params.userId,
      confirmEmail: request.body.confirmEmail,
    });

    reply.status(204).send();
  });
