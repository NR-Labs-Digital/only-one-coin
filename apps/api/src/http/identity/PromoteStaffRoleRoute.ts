import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const PromoteStaffRoleParamsSchema = z.object({
  userId: z.string().min(1),
});

const PromoteStaffRoleBodySchema = z.object({
  // `master` is deliberately absent: an account is born master through the
  // owners'-domain invite, never promoted into it. `teacher` travels with the
  // roster file.
  role: z.enum([
    "admin",
    "analyst",
    "enrollment_supervisor",
    "academic_supervisor",
    "sales",
    "support",
    "billing",
  ]),
  // The acting admin's own password, confirmed again right now — the only
  // way a `role` ever moves (CLAUDE.md §8, PromoteUserRoleUseCase).
  password: z.string().min(1),
});

const PromoteStaffRoleResponseSchema = z.object({
  targetUserId: z.string(),
  newRole: z.string(),
});

// Admin-only. `teacher` is deliberately absent from the body's role union:
// that cargo travels with the roster file it is scoped by, opened and closed
// from Docentes, never here (same rule the role-change dialog already draws).
// A teacher account cannot leave the cargo here either: PromoteUserRoleUseCase
// answers 422 `staff_role.teacher_account_locked` (OOC-79).
export const promoteStaffRoleRoute = RouteBuilder.patch("/staff/:userId/role")
  .docs({
    tags: ["Identity"],
    summary: "Change a panel account's cargo",
    description: "Requires the acting admin's own password again, even with their session open.",
  })
  .roles("master", "admin")
  .params(PromoteStaffRoleParamsSchema)
  .body(PromoteStaffRoleBodySchema)
  .response(200, PromoteStaffRoleResponseSchema)
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.staff.promoteRole.run({
      adminUserId: request.currentUser!.id,
      adminPassword: request.body.password,
      targetUserId: request.params.userId,
      newRole: request.body.role,
    });

    reply.status(200).send(result);
  });
