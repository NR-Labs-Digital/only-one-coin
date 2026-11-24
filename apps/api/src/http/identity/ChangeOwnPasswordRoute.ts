import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const ChangeOwnPasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  // The real rules (length, letters and numbers, not the current one) are the
  // usecase's — StaffPasswordPolicy — so the refusal carries its own reason.
  newPassword: z.string().min(1).max(256),
});

const ChangeOwnPasswordResponseSchema = z.object({
  changedAt: z.string(),
  otherSessionsClosed: z.number().int(),
});

// Every staff cargo: everyone with a panel account owns a password. The user
// is the session's own — the body carries no id to act on (CLAUDE.md §8,
// anti-IDOR). No rate limit yet (docs/ROADMAP.md Sessão 25); the session
// requirement is what stands between this and guessing the current password.
export const changeOwnPasswordRoute = RouteBuilder.post("/me/password")
  .docs({
    tags: ["Identity"],
    summary: "Change the signed-in staff member's own password",
    description:
      "Requires the current password. Closes every other open session of the account; the one making the change stays open.",
  })
  .can("account.self")
  .body(ChangeOwnPasswordBodySchema)
  .response(200, ChangeOwnPasswordResponseSchema)
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.staff.changeOwnPassword.run({
      userId: request.currentUser!.id,
      sessionToken: request.sessionToken!,
      currentPassword: request.body.currentPassword,
      newPassword: request.body.newPassword,
    });

    reply.status(200).send({
      changedAt: result.changedAt.toISOString(),
      otherSessionsClosed: result.otherSessionsClosed,
    });
  });
