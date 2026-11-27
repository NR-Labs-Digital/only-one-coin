import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { IdParamsSchema, IdResponseSchema } from "@/http/catalog/CatalogSchemas.js";

/**
 * The shared Classroom logins (OOC-196). Bodies are checked by the domain
 * (ClassroomAccountFieldsSchema), so a field error names its path. The list and its teachers are read
 * by whoever reads the roster's accounts (the teacher file's picker among
 * them); creating, editing, retiring and seeing a password is one permission.
 * The password never travels in a list — only through `…/password`, POST so
 * nothing caches or prefetches it, with an audit line every time.
 */
const ClassroomAccountItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  teachers: z.array(z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string() })),
  passwordChangedAt: z.string(),
  releasedAt: z.string().nullable(),
  passwordChangeDue: z.boolean(),
});

const CredentialsResponseSchema = z.object({
  email: z.string(),
  password: z.string(),
  passwordChangedAt: z.string(),
});

export const listClassroomAccountsRoute = RouteBuilder.get("/classroom-accounts")
  .docs({ tags: ["Teachers"], summary: "List the shared Classroom accounts and who uses each" })
  .can("teachers.classroom_accounts_view")
  .response(200, z.object({ items: z.array(ClassroomAccountItemSchema), maxTeachers: z.number().int() }))
  .handler(async (_request, reply) => {
    const list = await container.queries.listClassroomAccounts.run();
    reply.status(200).send({
      maxTeachers: list.maxTeachers,
      items: list.items.map((item) => ({
        ...item,
        passwordChangedAt: item.passwordChangedAt.toISOString(),
        releasedAt: item.releasedAt?.toISOString() ?? null,
      })),
    });
  });

export const createClassroomAccountRoute = RouteBuilder.post("/classroom-accounts")
  .docs({
    tags: ["Teachers"],
    summary: "Register a shared Classroom account",
    description: "The password is sealed (AES-256-GCM) before it is stored. 409 classroom_account.exists for a live e-mail.",
  })
  .can("teachers.classroom_accounts")
  .body(z.object({ email: z.string().optional(), password: z.string().optional() }))
  .response(201, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const account = await container.useCases.classroomAccount.create.run({
      actorId: request.currentUser!.id,
      // Missing fields reach the domain as empty, so the answer says `required` on their path.
      account: { email: request.body.email ?? "", password: request.body.password ?? "" },
    });
    reply.status(201).send({ id: account.id });
  });

export const updateClassroomAccountRoute = RouteBuilder.patch("/classroom-accounts/:id")
  .docs({
    tags: ["Teachers"],
    summary: "Change a Classroom account's e-mail or password",
    description: "Left out = kept. A new password clears the 'change the password' flag.",
  })
  .can("teachers.classroom_accounts")
  .params(IdParamsSchema)
  .body(z.object({ email: z.string().optional(), password: z.string().optional() }))
  .response(200, IdResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const account = await container.useCases.classroomAccount.update.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
      changes: request.body,
    });
    reply.status(200).send({ id: account.id });
  });

export const retireClassroomAccountRoute = RouteBuilder.post("/classroom-accounts/:id/retire")
  .docs({
    tags: ["Teachers"],
    summary: "Take a Classroom account off the list",
    description: "Refused (409 classroom_account.in_use) while a teacher still uses it.",
  })
  .can("teachers.classroom_accounts")
  .params(IdParamsSchema)
  .response(204, z.null())
  .response(409, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .handler(async (request, reply) => {
    await container.useCases.classroomAccount.retire.run({ actorId: request.currentUser!.id, id: request.params.id });
    reply.status(204).send(null);
  });

export const revealClassroomAccountPasswordRoute = RouteBuilder.post("/classroom-accounts/:id/password")
  .docs({
    tags: ["Teachers"],
    summary: "Show a Classroom account's password",
    description: "Every reveal is an audit line (classroom_account.password_viewed). 503 when the sealed value cannot be opened.",
  })
  .can("teachers.classroom_accounts")
  .params(IdParamsSchema)
  .response(200, CredentialsResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const credentials = await container.useCases.classroomAccount.revealPassword.run({
      actorId: request.currentUser!.id,
      id: request.params.id,
    });
    reply
      .header("cache-control", "no-store")
      .status(200)
      .send({
        email: credentials.email,
        password: credentials.password,
        passwordChangedAt: credentials.passwordChangedAt.toISOString(),
      });
  });

/**
 * "Ver mis accesos de Classroom" (OOC-196): the signed-in teacher's own
 * account, resolved from the session (no id in the address). `access: null`
 * when the file has none.
 */
export const ownClassroomAccessRoute = RouteBuilder.post("/teaching/classroom-access")
  .docs({
    tags: ["Teaching"],
    summary: "Show the signed-in teacher's Classroom login",
    description: "Every reveal is an audit line. 503 when the sealed password cannot be opened.",
  })
  .can("teaching.own_classroom_access")
  .response(200, z.object({ access: CredentialsResponseSchema.nullable() }))
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const credentials = await container.useCases.classroomAccount.getOwnAccess.run({ userId: request.currentUser!.id });
    reply
      .header("cache-control", "no-store")
      .status(200)
      .send({
        access: credentials
          ? {
              email: credentials.email,
              password: credentials.password,
              passwordChangedAt: credentials.passwordChangedAt.toISOString(),
            }
          : null,
      });
  });
