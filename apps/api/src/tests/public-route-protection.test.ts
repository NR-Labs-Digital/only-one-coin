import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import pino from "pino";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { RATE_LIMITS, perSeatHold } from "@/shared/http/rateLimit.js";
import clientIpPlugin from "@/infra/plugins/clientIp.js";
import rateLimitPlugin from "@/infra/plugins/rateLimit.js";
import errorHandlerPlugin from "@/infra/plugins/errorHandler.js";
import { PROXY_CLIENT_IP_HEADER, PROXY_SECRET_HEADER, resolveClientIp } from "@/infra/edge/clientIp.js";
import type { RateLimiter } from "@/infra/edge/RedisRateLimiter.js";
import { RedisIdempotencyCache, type IdempotencyBegin } from "@/infra/edge/RedisIdempotencyCache.js";

/**
 * OOC-24: the public checkout behind a captcha, rate limits and an
 * idempotency cache. Nothing here needs Redis or Postgres — the counters and
 * the cache run on in-memory fakes, the usecase is stubbed.
 */

const silent = pino({ level: "silent" });

/** Counts in memory, never expires — a window that never ends is enough here. */
function memoryLimiter(): RateLimiter & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    hit: async (key) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, resetMs: 42_000 };
    },
  };
}

async function buildLimitedApp(limiter: RateLimiter): Promise<FastifyInstance> {
  const app = fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin);
  await app.register(clientIpPlugin, { proxySecret: undefined });
  await app.register(rateLimitPlugin, { limiter });

  const provider = app.withTypeProvider<ZodTypeProvider>();
  provider.route(
    RouteBuilder.post("/open")
      .public()
      .rateLimit({ name: "open:ip", by: "ip", limit: 2, windowSeconds: 60 }, perSeatHold("open", 1, "holdId"))
      .body(z.object({ holdId: z.string().optional() }))
      .handler(async (_request, reply) => {
        reply.send({ ok: true });
      }),
  );

  await app.ready();
  return app;
}

describe("rate limit plugin", () => {
  it("fails app boot when a public route declares no rate limit", async () => {
    const app = fastify();
    await app.register(rateLimitPlugin, { limiter: memoryLimiter() });

    expect(() => app.route(RouteBuilder.get("/naked").public().handler(async () => ({})))).toThrow(
      /missing a rate limit declaration/,
    );
  });

  it("gives a session-gated route the per-user staff budget by default", () => {
    const route = RouteBuilder.get("/staff").roles("admin").handler(async () => ({}));
    expect(route.config?.rateLimit).toEqual([RATE_LIMITS.staff]);
  });

  it("refuses past the limit with 429, the public envelope and Retry-After", async () => {
    const app = await buildLimitedApp(memoryLimiter());
    const send = () => app.inject({ method: "POST", url: "/open", payload: {} });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const refused = await send();

    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBe("42");
    expect(refused.json()).toEqual({ status: 429, reason: "rate_limit.exceeded", path: "/open" });
    await app.close();
  });

  it("counts per hold apart from per IP, and skips the rule when the request names no hold", async () => {
    const app = await buildLimitedApp(memoryLimiter());

    expect((await app.inject({ method: "POST", url: "/open", payload: { holdId: "h1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/open", payload: { holdId: "h1" } })).statusCode).toBe(429);
    await app.close();
  });

  it("never puts the IP itself in a Redis key", async () => {
    const limiter = memoryLimiter();
    const app = await buildLimitedApp(limiter);
    await app.inject({ method: "POST", url: "/open", payload: {}, headers: { "x-forwarded-for": "203.0.113.9" } });

    const keys = [...limiter.counts.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ooc:rl:open:ip:[0-9a-f]{32}$/);
    expect(keys[0]).not.toContain("203.0.113.9");
    await app.close();
  });

  it("lets the request through when the counter is unavailable (fail-open)", async () => {
    const app = await buildLimitedApp({ hit: async () => null });
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: "POST", url: "/open", payload: {} })).statusCode).toBe(200);
    }
    await app.close();
  });
});

describe("resolveClientIp", () => {
  const SECRET = "s".repeat(32);

  it("believes the proxy's header only next to the shared secret", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, [PROXY_CLIENT_IP_HEADER]: "198.51.100.7", "fly-client-ip": "76.76.21.21" };
    expect(resolveClientIp(headers, "10.0.0.1", SECRET)).toBe("198.51.100.7");
  });

  it("falls back to the connection when the secret is wrong or missing", () => {
    const forged = { [PROXY_SECRET_HEADER]: "wrong", [PROXY_CLIENT_IP_HEADER]: "198.51.100.7", "fly-client-ip": "76.76.21.21" };
    expect(resolveClientIp(forged, "10.0.0.1", SECRET)).toBe("76.76.21.21");
    // Ignores X-Forwarded-For too: with a secret configured, it is just another header a direct caller writes.
    expect(resolveClientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.1", SECRET)).toBe("10.0.0.1");
  });

  it("uses the first X-Forwarded-For hop when no secret is configured", () => {
    expect(resolveClientIp({ "x-forwarded-for": "198.51.100.7, 76.76.21.21" }, "10.0.0.1", undefined)).toBe(
      "198.51.100.7",
    );
  });

  it("never takes something that is not an IP", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, [PROXY_CLIENT_IP_HEADER]: "not-an-ip" };
    expect(resolveClientIp(headers, "10.0.0.1", SECRET)).toBe("10.0.0.1");
  });
});

/** Just enough of ioredis for the cache: SET (PX, NX), GET, DEL. */
function memoryRedis(): Redis {
  const store = new Map<string, string>();
  return {
    set: async (key: string, value: string, ..._args: unknown[]) => {
      const nx = _args.includes("NX");
      if (nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    get: async (key: string) => store.get(key) ?? null,
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  } as unknown as Redis;
}

describe("RedisIdempotencyCache", () => {
  it("runs the first request, holds the second off while it runs, replays it once it is done", async () => {
    const cache = new RedisIdempotencyCache(memoryRedis(), silent);

    const first = await cache.begin("scope", "k1", "fp");
    expect(first.kind).toBe("fresh");
    expect((await cache.begin("scope", "k1", "fp")).kind).toBe("in_progress");

    await (first as Extract<IdempotencyBegin, { kind: "fresh" }>).complete({ id: 1 });
    expect(await cache.begin("scope", "k1", "fp")).toEqual({ kind: "replay", response: { id: 1 } });
  });

  it("frees the key when the first request failed", async () => {
    const cache = new RedisIdempotencyCache(memoryRedis(), silent);
    const first = (await cache.begin("scope", "k1", "fp")) as Extract<IdempotencyBegin, { kind: "fresh" }>;
    await first.abandon();

    expect((await cache.begin("scope", "k1", "fp")).kind).toBe("fresh");
  });

  it("refuses the same key for a different request", async () => {
    const cache = new RedisIdempotencyCache(memoryRedis(), silent);
    await cache.begin("scope", "k1", "fp");

    expect((await cache.begin("scope", "k1", "other")).kind).toBe("mismatch");
  });

  it("falls through to the database when Redis is unavailable", async () => {
    const broken = { set: async () => Promise.reject(new Error("down")) } as unknown as Redis;
    const cache = new RedisIdempotencyCache(broken, silent);

    expect((await cache.begin("scope", "k1", "fp")).kind).toBe("fresh");
  });
});

describe("POST /enrollments/public — captcha and idempotency", () => {
  const BODY = {
    captchaToken: "turnstile-token",
    holdId: "018f2b5c-5000-7000-8000-000000000001",
    receiptUploadId: "018f2b5c-5000-7000-8000-000000000002",
    classGroupId: "018f2b5c-5000-7000-8000-000000000003",
    planId: "018f2b5c-5000-7000-8000-000000000004",
    student: {
      firstName: "Rosa",
      lastName: "Quispe",
      nationalIdType: "DNI",
      nationalId: "70123456",
      email: "rosa.quispe@gmail.com",
      phone: "987654321",
      birthDate: "1996-04-12",
      country: "PE",
      region: "Lima",
      city: "Chorrillos",
    },
    guardian: null,
    locale: "es-PE",
    payment: {
      method: "yape",
      methodDetail: null,
      operationNumber: "12345678",
      idempotencyKey: "018f2b5c-5000-7000-8000-000000000005",
    },
  };
  const RESULT = {
    enrollmentId: "018f2b5c-5000-7000-8000-0000000000e1",
    paymentId: "018f2b5c-5000-7000-8000-0000000000f1",
  };

  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubEdge(begin: IdempotencyBegin) {
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue({ count: 1, resetMs: 1000 });
    vi.spyOn(container.edge.idempotency, "begin").mockResolvedValue(begin);
  }

  function freshAttempt() {
    return { kind: "fresh" as const, complete: vi.fn(async () => {}), abandon: vi.fn(async () => {}) };
  }

  const submit = () => app.inject({ method: "POST", url: "/api/v1/enrollments/public", payload: BODY });

  it("answers a retry of a finished submit from the cache — no captcha, no database", async () => {
    stubEdge({ kind: "replay", response: RESULT });
    const verify = vi.spyOn(container.edge.captcha, "verify");
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run");

    const response = await submit();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(RESULT);
    expect(verify).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("says 409 while the first attempt is still running", async () => {
    stubEdge({ kind: "in_progress" });
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run");

    const response = await submit();

    expect(response.statusCode).toBe(409);
    expect(response.json<{ reason: string }>().reason).toBe("idempotency.in_progress");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a failed captcha before the usecase, and frees the key", async () => {
    const attempt = freshAttempt();
    stubEdge(attempt);
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("failed");
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run");

    const response = await submit();

    expect(response.statusCode).toBe(422);
    expect(response.json<{ reason: string }>().reason).toBe("captcha.failed");
    expect(run).not.toHaveBeenCalled();
    expect(attempt.abandon).toHaveBeenCalled();
  });

  it("refuses with 503 when the captcha cannot be checked — closed, not open", async () => {
    stubEdge(freshAttempt());
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("unavailable");
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run");

    const response = await submit();

    expect(response.statusCode).toBe(503);
    expect(response.json<{ reason: string }>().reason).toBe("captcha.unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("records the finished submit and stamps consent with the student's IP, not the proxy's", async () => {
    const attempt = freshAttempt();
    stubEdge(attempt);
    const verify = vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run").mockResolvedValue({
      enrollments: [{ id: RESULT.enrollmentId }],
      payment: { id: RESULT.paymentId },
    } as unknown as Awaited<ReturnType<typeof container.useCases.enrollment.submitPublic.run>>);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/public",
      headers: { "x-forwarded-for": "198.51.100.7" },
      payload: {
        ...BODY,
        guardian: {
          firstName: "Ana",
          lastName: "Quispe",
          relationship: "mother",
          nationalIdType: "DNI",
          nationalId: "40123456",
          email: "ana@hotmail.com",
          phone: "987654321",
          consentAccepted: true,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(verify).toHaveBeenCalledWith("turnstile-token", "198.51.100.7");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ consent: { version: "v1", ip: "198.51.100.7" } }));
    expect(attempt.complete).toHaveBeenCalledWith(RESULT);
    expect(attempt.abandon).not.toHaveBeenCalled();
  });

  it("takes a lot: every person and item to the usecase, the guardian's consent stamped once (OOC-158)", async () => {
    const attempt = freshAttempt();
    stubEdge(attempt);
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run").mockResolvedValue({
      enrollments: [{ id: RESULT.enrollmentId }, { id: "018f2b5c-5000-7000-8000-0000000000e2" }],
      payment: { id: RESULT.paymentId },
    } as unknown as Awaited<ReturnType<typeof container.useCases.enrollment.submitPublic.run>>);
    const guardian = {
      firstName: "Ana",
      lastName: "Quispe",
      relationship: "mother",
      nationalIdType: "DNI",
      nationalId: "40123456",
      email: "ana@hotmail.com",
      phone: "987654321",
      consentAccepted: true,
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/public/lot",
      headers: { "x-forwarded-for": "198.51.100.7" },
      payload: {
        captchaToken: BODY.captchaToken,
        receiptUploadId: BODY.receiptUploadId,
        locale: "es-PE",
        payment: BODY.payment,
        people: [
          { student: BODY.student, guardian },
          { student: { ...BODY.student, nationalId: "70123457", email: "luis.quispe@gmail.com" }, guardian },
        ],
        items: [
          { holdId: BODY.holdId, classGroupId: BODY.classGroupId, planId: BODY.planId, person: 0 },
          { holdId: "018f2b5c-5000-7000-8000-000000000009", classGroupId: BODY.classGroupId, planId: BODY.planId, person: 1 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      enrollmentIds: [RESULT.enrollmentId, "018f2b5c-5000-7000-8000-0000000000e2"],
      paymentId: RESULT.paymentId,
    });
    const input = run.mock.calls[0]![0];
    expect(input.items.map((item) => [item.seatHoldId, item.person])).toEqual([
      [BODY.holdId, 0],
      ["018f2b5c-5000-7000-8000-000000000009", 1],
    ]);
    expect(input.people).toHaveLength(2);
    expect(input.people[1]!.guardian).not.toHaveProperty("consentAccepted");
    expect(input.consent).toEqual({ version: "v1", ip: "198.51.100.7" });
  });

  it("refuses a lot past the ceiling before anything runs (OOC-158)", async () => {
    stubEdge(freshAttempt());
    const run = vi.spyOn(container.useCases.enrollment.submitPublic, "run");
    const item = { holdId: BODY.holdId, classGroupId: BODY.classGroupId, planId: BODY.planId, person: 0 };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/public/lot",
      payload: {
        captchaToken: BODY.captchaToken,
        receiptUploadId: BODY.receiptUploadId,
        payment: BODY.payment,
        people: [{ student: BODY.student, guardian: null }],
        items: Array.from({ length: 11 }, () => item),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
