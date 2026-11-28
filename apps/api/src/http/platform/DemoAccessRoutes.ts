import { z } from "zod";
import { DEMO_ACCESS_KINDS, type DemoAccessView } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

/*
 * The owners' demo accesses (28/11/2026, apps/api CLAUDE.md "Contas demo"):
 * an account a client signs in with to see the student or the teacher portal.
 * Owners only, by e-mail like the rest of the NR Labs area — `.owners()` at the
 * door, and the usecases check it again.
 */

const DemoAccessSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(DEMO_ACCESS_KINDS),
  email: z.string(),
  name: z.string(),
  courseName: z.string(),
  classGroupCode: z.string(),
  activated: z.boolean(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

function accessDto(access: DemoAccessView): z.infer<typeof DemoAccessSchema> {
  return {
    ...access,
    createdAt: access.createdAt.toISOString(),
    revokedAt: access.revokedAt ? access.revokedAt.toISOString() : null,
  };
}

export const listDemoAccessesRoute = RouteBuilder.get("/platform/demo-accesses")
  .docs({
    tags: ["Platform"],
    summary: "List the demo accesses and the courses one can open in",
    description: "Restricted to the platform owners' e-mail domain.",
  })
  .owners()
  .response(
    200,
    z.object({
      accesses: z.array(DemoAccessSchema),
      courses: z.array(z.object({ id: z.string().uuid(), name: z.string(), language: z.string() })),
    }),
  )
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .handler(async (_request, reply) => {
    const { repository } = container.useCases.platform.demo;
    const [accesses, courses] = await Promise.all([repository.list(), repository.courseOptions()]);
    reply.status(200).send({ accesses: accesses.map(accessDto), courses });
  });

export const createDemoAccessRoute = RouteBuilder.post("/platform/demo-accesses")
  .docs({
    tags: ["Platform"],
    summary: "Open a demo access to the student or the teacher portal",
    description:
      "Writes a demo class group with a demo student (confirmed seat, no payment) or a demo teacher with a fictitious roster, hidden from every staff list, then sends the set-password link or the teacher invite. Writes audit_log.",
  })
  .owners()
  .body(
    z.object({
      kind: z.enum(DEMO_ACCESS_KINDS),
      email: z.string().trim().min(3).max(254),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      courseId: z.string().uuid(),
    }),
  )
  .response(201, z.object({ id: z.string().uuid() }))
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const user = request.currentUser!;
    const result = await container.useCases.platform.demo.create.run({
      actorId: user.id,
      actorEmail: user.email,
      actorPermissions: container.identity.staffAccess.permissionsOf(user),
      ...request.body,
    });
    reply.status(201).send({ id: result.accessId });
  });

export const revokeDemoAccessRoute = RouteBuilder.post("/platform/demo-accesses/:id/revoke")
  .docs({
    tags: ["Platform"],
    summary: "Close a demo access for good",
    description: "Retires the account, cancels an open invite and retires the demo class group. Writes audit_log.",
  })
  .owners()
  .params(z.object({ id: z.string().uuid() }))
  .response(204, z.void())
  .response(401, ErrorResponseSchema)
  .response(403, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.platform.demo.revoke.run({
      actorId: request.currentUser!.id,
      actorEmail: request.currentUser!.email,
      accessId: request.params.id,
    });
    reply.status(204).send();
  });
