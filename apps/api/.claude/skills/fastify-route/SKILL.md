---
name: fastify-route
description: How to add a new HTTP route in apps/api — the RouteBuilder pattern, mandatory auth declaration, error contract, and how to wire it into app.ts. Use whenever creating or modifying a route under apps/api/src/http/.
---

# Adding a route in `apps/api`

## File location

One file per route, under `src/http/<bounded-context>/<VerbNounRoute>.ts` —
match an existing context (`enrollment/`, `student/`, `catalog/`, `identity/`,
`platform/`, `auth/`) or create a new one if the route belongs to a context
that doesn't exist yet. Name the file after what it does, not the HTTP verb
alone (`CreateManualEnrollmentRoute.ts`, not `PostEnrollment.ts`).

## The shape (copy this skeleton)

```ts
import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";

const SomeActionBodySchema = z.object({ /* ... */ });
const SomeActionResponseSchema = z.object({ /* ... */ });

export const someActionRoute = RouteBuilder.post("/some-resource")
  .docs({
    tags: ["SomeResource"],
    summary: "One line, what it does",
    description: "Why it exists / who calls it, if not obvious",
  })
  .roles("master", "admin") // or .owners() or .public() — exactly one, always
  .body(SomeActionBodySchema)
  .response(201, SomeActionResponseSchema)
  .response(400, ErrorResponseSchema)
  .response(404, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const result = await container.useCases.someContext.someAction.run(request.body);
    reply.status(201).send(result);
  });
```

## The one rule that isn't optional

**Every route calls exactly one of `.roles(...)`, `.owners()`, or
`.public()`.** This isn't a lint suggestion — `infra/plugins/authorization.ts`
registers an `onRoute` hook that throws at **application boot** if a route
has none. A route you forgot to gate doesn't ship half-protected; the whole
process fails to start, in every environment including CI's `tsc`/build
step. `.owners()` is different from any role: it's the platform-owner email
domains (`isOwnerEmail`), not a `role` column check — use it only for things
like feature-flag writes, never as a stand-in for `admin`.

The generic mechanism is covered by
`src/infra/plugins/authorization.test.ts` (builds a throwaway app with
synthetic `.roles()`/`.owners()`/`.public()` routes and asserts the 401/403
behavior). That test does **not** enumerate your new route or check that the
roles you chose are the right ones for the business rule — that's a manual
call, informed by `CLAUDE.md` §8's role definitions and, if you're changing
who can do what, the `rbac-role-change` skill.

## Handler body

- The handler calls into `container.useCases.<context>.<action>.run(...)` —
  business logic lives in `packages/domain` usecases, not in the route file.
  If the usecase doesn't exist yet, check `src/container.ts`'s `AppUseCases`
  interface for the shape to add.
- Never throw a raw `Error` or let a provider's native error escape. Throw
  the `HttpError` subclasses from `packages/domain`
  (`UnauthorizedError`/`ForbiddenError`/`NotFoundError`/`UnableToProcessEntryError`)
  — `infra/plugins/errorHandler.ts` maps them to the public envelope
  `{status, reason, path?, errorId?}`. A raw message reaching the client is
  the exact bug class `CLAUDE.md` §4/§6 exist to prevent.
- Anti-IDOR: never trust an id from `request.params`/`request.body` as
  sufficient authorization by itself — compare it against something derived
  from the authenticated session (see how teacher-scoped routes compare
  `teacher_id` to the session user, not to client input).

## Wiring it in

Add the import and the `.route(...)` call in `src/app.ts`, inside the
`/api/v1`-prefixed `provider.register(...)` block (unless the route is
public-and-unprefixed like auth or health-check, which sit above that
block) — follow the existing import/registration order, one line each,
grouped by bounded context.

## Persistence

If the usecase needs a repository or query that doesn't exist yet, add it
under `src/infra/persistence/<context>/` (Drizzle — see any existing file
there for the pattern) and wire it into `container.ts`'s `AppRepositories`/
`AppQueries`. Never query the database straight from the route handler.
