import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@ooc/domain";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import authorizationPlugin from "@/infra/plugins/authorization.js";
import errorHandlerPlugin from "@/infra/plugins/errorHandler.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import { container } from "@/container.js";
import { buildApp } from "@/app.js";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(authorizationPlugin);

  const provider = app.withTypeProvider<ZodTypeProvider>();

  provider.route(
    RouteBuilder.get("/supervisor-only")
      .roles("enrollment_supervisor", "admin")
      .response(200, z.object({ ok: z.boolean() }))
      .handler(async (_request, reply) => {
        reply.send({ ok: true });
      }),
  );

  provider.route(
    RouteBuilder.get("/owners-only")
      .owners()
      .response(200, z.object({ ok: z.boolean() }))
      .handler(async (_request, reply) => {
        reply.send({ ok: true });
      }),
  );

  provider.route(
    RouteBuilder.get("/open")
      .public()
      .response(200, z.object({ ok: z.boolean() }))
      .handler(async (_request, reply) => {
        reply.send({ ok: true });
      }),
  );

  await app.ready();
  return app;
}

describe("authorization plugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails app boot when a route declares neither .roles() nor .public()", async () => {
    const app = fastify();
    await app.register(errorHandlerPlugin);
    await app.register(authorizationPlugin);

    const provider = app.withTypeProvider<ZodTypeProvider>();

    expect(() =>
      provider.route(
        RouteBuilder.get("/missing-auth-declaration")
          .response(200, z.object({ ok: z.boolean() }))
          .handler(async (_request, reply) => reply.send({ ok: true })),
      ),
    ).toThrow(/missing an auth declaration/);
  });

  it("the real app boots successfully (every registered route declared auth)", async () => {
    const app = await buildApp();
    await app.close();
  });

  it("rejects a role-gated route with no session cookie", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/supervisor-only" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a role-gated route when the session belongs to the wrong role", async () => {
    const app = await buildTestApp();
    const billingUser: AuthenticatedUser = {
      id: "u1",
      email: "t@example.com",
      name: "Treasury User",
      role: "billing",
    };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(billingUser);

    const response = await app.inject({
      method: "GET",
      url: "/supervisor-only",
      cookies: { [SESSION_COOKIE_NAME]: "some-valid-token" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("allows a role-gated route when the session role is in the allowed list", async () => {
    const app = await buildTestApp();
    const supervisorUser: AuthenticatedUser = {
      id: "u2",
      email: "c@example.com",
      name: "Coordinator User",
      role: "enrollment_supervisor",
    };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(supervisorUser);

    const response = await app.inject({
      method: "GET",
      url: "/supervisor-only",
      cookies: { [SESSION_COOKIE_NAME]: "some-valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  /* The owners' door (CLAUDE.md §5): the e-mail domain decides, not the cargo
     — so a legitimate `admin` of the Asociación is refused, and an owner
     passes on a cargo that would fail every other gate in the panel. */
  it("refuses an .owners() route to an admin outside the owners' domain", async () => {
    const app = await buildTestApp();
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue({
      id: "u3",
      email: "admin@onlyonecoin.edu.pe",
      name: "Admin de la Asociación",
      role: "admin",
    } satisfies AuthenticatedUser);

    const response = await app.inject({
      method: "GET",
      url: "/owners-only",
      cookies: { [SESSION_COOKIE_NAME]: "some-valid-token" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("allows an .owners() route to the owners' domain whatever the cargo", async () => {
    const app = await buildTestApp();
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue({
      id: "u4",
      email: "rick@nrlabsdigital.com",
      name: "Owner",
      role: "support",
    } satisfies AuthenticatedUser);

    const response = await app.inject({
      method: "GET",
      url: "/owners-only",
      cookies: { [SESSION_COOKIE_NAME]: "some-valid-token" },
    });

    expect(response.statusCode).toBe(200);
  });

  /* Second owners' domain, added 17/09/2026 (CLAUDE.md §8) because the
     account actually used as the team's production login carries it. */
  it("allows an .owners() route to the second owners' domain whatever the cargo", async () => {
    const app = await buildTestApp();
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue({
      id: "u5",
      email: "team@admin.com",
      name: "Owner via admin.com",
      role: "support",
    } satisfies AuthenticatedUser);

    const response = await app.inject({
      method: "GET",
      url: "/owners-only",
      cookies: { [SESSION_COOKIE_NAME]: "some-valid-token" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuses an .owners() route with no session at all", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/owners-only" });
    expect(response.statusCode).toBe(401);
  });

  it("never checks the session for a .public() route", async () => {
    const app = await buildTestApp();
    const resolveSpy = vi.spyOn(container.identity.currentSession, "resolve");

    const response = await app.inject({ method: "GET", url: "/open" });

    expect(response.statusCode).toBe(200);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
