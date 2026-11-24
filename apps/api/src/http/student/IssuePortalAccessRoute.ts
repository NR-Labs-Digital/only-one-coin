import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

// Same audience as the student file itself (GetStudentRoute): whoever runs
// the enrollment side. Billing settles money, it does not hand out accounts.
export const issuePortalAccessRoute = RouteBuilder.post("/students/:studentId/portal-access")
  .docs({
    tags: ["Students"],
    summary: "Send the student their portal access",
    description:
      "Creates the account, re-sends the activation, or sends a reset link — whichever applies. Opens the guardian's account with a new student account, and on an existing one while a minor's consent is pending (OOC-72); `guardian` says what that did.",
  })
  .can("students.portal_access")
  .params(z.object({ studentId: z.string().uuid() }))
  .body(z.object({}))
  .response(
    200,
    z.object({
      outcome: z.enum(["created", "linked_existing", "already_linked", "email_conflict", "activation_resent", "reset_sent"]),
      guardian: z.enum(["created", "linked", "activation_resent", "active", "conflict"]).nullable(),
    }),
  )
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.portal.issueAccess.run({ actorId: request.currentUser!.id, studentId: request.params.studentId });
    reply.status(200).send(result);
  });
