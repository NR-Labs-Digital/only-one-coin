import type { Role } from "@ooc/domain";
import type { FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import type { z, ZodType } from "zod";
import type { RouteAuth } from "@/infra/plugins/authorization.js";
import { RATE_LIMITS, type RateLimitRule } from "@/shared/http/rateLimit.js";

interface RouteSchema {
  tags?: string[];
  summary?: string;
  description?: string;
  body?: ZodType;
  params?: ZodType;
  querystring?: ZodType;
  response?: Record<number, ZodType>;
}

export class RouteBuilder<
  TBody extends ZodType = ZodType,
  TParams extends ZodType = ZodType,
  TQuery extends ZodType = ZodType,
> {
  private readonly method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  private readonly url: string;
  private schema: RouteSchema = {};
  // No default — deny-by-default (CLAUDE.md §6) is enforced by requiring
  // every route to call .roles(...), .owners() or .public() explicitly. A
  // route built without one fails at registration time (authorization
  // plugin's onRoute hook), not silently open.
  private auth?: RouteAuth;
  // Same deal for the rate limit (CLAUDE.md §6): a public route has to name
  // its own; a session-gated one falls back to the per-user staff budget.
  private rateLimitRules?: RateLimitRule[];

  private constructor(method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string) {
    this.method = method;
    this.url = url;
  }

  static post(url: string) {
    return new RouteBuilder("POST", url);
  }

  static get(url: string) {
    return new RouteBuilder("GET", url);
  }

  static put(url: string) {
    return new RouteBuilder("PUT", url);
  }

  static patch(url: string) {
    return new RouteBuilder("PATCH", url);
  }

  static delete(url: string) {
    return new RouteBuilder("DELETE", url);
  }

  docs(info: { tags?: string[]; summary?: string; description?: string }) {
    this.schema = { ...this.schema, ...info };
    return this;
  }

  body<T extends ZodType>(schema: T): RouteBuilder<T, TParams, TQuery> {
    this.schema.body = schema;
    return this as unknown as RouteBuilder<T, TParams, TQuery>;
  }

  params<T extends ZodType>(schema: T): RouteBuilder<TBody, T, TQuery> {
    this.schema.params = schema;
    return this as unknown as RouteBuilder<TBody, T, TQuery>;
  }

  query<T extends ZodType>(schema: T): RouteBuilder<TBody, TParams, T> {
    this.schema.querystring = schema;
    return this as unknown as RouteBuilder<TBody, TParams, T>;
  }

  response(statusCode: number, schema: ZodType) {
    this.schema.response = { ...this.schema.response, [statusCode]: schema };
    return this;
  }

  /** Restricts the route to the given roles — checked against the caller's
   * `user.role` on every request (CLAUDE.md §8). */
  roles(...roles: [Role, ...Role[]]) {
    this.auth = { public: false, roles };
    return this;
  }

  /**
   * Restricts the route to the platform owners — the accounts on the owners'
   * e-mail domain, whatever cargo they carry (CLAUDE.md §5). Not a role: this
   * is the door to what belongs to whoever runs the platform, not to whoever
   * runs the school.
   */
  owners() {
    this.auth = { public: false, owners: true };
    return this;
  }

  /**
   * Lets a cargo that must have the second factor reach this route before
   * turning it on (CLAUDE.md §8) — only for the routes that turn it on. Every
   * other session-gated route refuses that account with
   * `auth.mfa_enrollment_required`. Call after `.roles()`/`.owners()`.
   */
  allowBeforeMfa() {
    if (!this.auth || this.auth.public) {
      throw new Error("allowBeforeMfa() only applies after .roles(...) or .owners().");
    }
    this.auth = { ...this.auth, beforeMfa: true };
    return this;
  }

  /** Explicitly marks the route as open to unauthenticated callers — the
   * only other way to satisfy the deny-by-default requirement. */
  public() {
    this.auth = { public: true };
    return this;
  }

  /**
   * The counters this route spends from (shared/http/rateLimit.ts). Required
   * on a `.public()` route — the boot fails without it. Optional on a
   * session-gated one, which otherwise spends the staff per-user budget.
   */
  rateLimit(...rules: [RateLimitRule, ...RateLimitRule[]]) {
    this.rateLimitRules = rules;
    return this;
  }

  handler(
    fn: (
      request: FastifyRequest<{
        Body: z.infer<TBody>;
        Params: z.infer<TParams>;
        Querystring: z.infer<TQuery>;
      }>,
      reply: FastifyReply,
    ) => Promise<unknown> | void,
  ): RouteOptions {
    return {
      method: this.method,
      url: this.url,
      schema: this.schema,
      config: {
        auth: this.auth,
        rateLimit: this.rateLimitRules ?? (this.auth && !this.auth.public ? [RATE_LIMITS.staff] : undefined),
      },
      handler: fn as RouteOptions["handler"],
    };
  }
}
