import {
  InsufficientPrivilegeError,
  MfaEnrollmentRequiredError,
  NotAPlatformOwnerError,
  UnauthorizedError,
  isOwnerEmail,
  type AuthenticatedUser,
  type PermissionKey,
  type Role,
} from "@ooc/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * The ways a route may declare who it answers to. A staff route names the
 * permission it needs (OOC-183); the portal's routes name their roles; the
 * owners' door is the e-mail domain. `beforeMfa` marks the handful of routes a
 * cargo that must have the second factor can still reach before turning it
 * on: the ones that turn it on.
 */
export type RouteAuth =
  | { public: true }
  | { public: false; permission: PermissionKey; alsoRoles: Role[]; beforeMfa?: true }
  | { public: false; roles: Role[]; beforeMfa?: true }
  | { public: false; owners: true; beforeMfa?: true };

/** One registered route and what it declared — what the role matrix (OOC-57) reads. */
export interface DeclaredRoute {
  method: string;
  url: string;
  auth: RouteAuth;
}

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: RouteAuth;
  }

  interface FastifyInstance {
    /**
     * Every route registered on this app with the access it declared,
     * collected by the same `onRoute` hook that enforces the declaration. The
     * role matrix is built from this list, so it can never say something the
     * routes do not enforce (OOC-57).
     */
    declaredRoutes: DeclaredRoute[];
  }

  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
    /** The raw session cookie the request was authorized with — set with `currentUser`. */
    sessionToken?: string;
  }
}

// Better Auth prefixes the cookie `__Secure-{name}` whenever its baseURL is
// https (BETTER_AUTH_URL always is in staging/production) — its own reader
// checks the prefixed name first, falling back to the bare one
// (better-auth/dist/cookies/index.mjs, `getCookie`). Every request in
// production carries the prefixed name; matching only the bare one meant
// this always returned null there — a valid session looked identical to no
// cookie at all, no error anywhere (only caught by testing a real login).
const SECURE_SESSION_COOKIE_NAME = `__Secure-${SESSION_COOKIE_NAME}`;

function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  let bareValue: string | null = null;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());

    if (name === SECURE_SESSION_COOKIE_NAME) {
      return value;
    }
    if (name === SESSION_COOKIE_NAME) {
      bareValue = value;
    }
  }

  return bareValue;
}

/**
 * Deny-by-default authorization (CLAUDE.md §6, §8): every route must declare
 * .roles(...) or .public() on its RouteBuilder — a route registered without
 * either fails app boot via the onRoute hook below, not just a request at
 * runtime. `role` is re-read from the database on every request through
 * ICurrentSessionPort, never trusted from a client-supplied header/JWT
 * (CLAUDE.md §8).
 */
async function authorizationPlugin(app: FastifyInstance) {
  const declaredRoutes: DeclaredRoute[] = [];
  app.decorate("declaredRoutes", declaredRoutes);

  app.addHook("onRoute", (routeOptions) => {
    const auth = routeOptions.config?.auth;
    if (auth === undefined) {
      throw new Error(
        `Route ${String(routeOptions.method)} ${routeOptions.url} is missing an auth declaration ` +
          `— call .can(...), .roles(...), .owners() or .public() on its RouteBuilder (CLAUDE.md §6).`,
      );
    }

    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      // Fastify adds a HEAD twin to every GET; it is the same door.
      if (method === "HEAD") continue;
      declaredRoutes.push({ method, url: routeOptions.url, auth });
    }
  });

  app.addHook("onRequest", async (request: FastifyRequest) => {
    const auth = request.routeOptions.config?.auth;

    // onRoute already guarantees every registered route has this set;
    // narrowed here only so TypeScript knows `auth` isn't undefined below.
    if (!auth || auth.public) {
      return;
    }

    const sessionToken = extractSessionToken(request.headers.cookie);
    if (!sessionToken) {
      throw new UnauthorizedError({
        reason: "auth.session_required",
        message: "No session cookie present.",
        path: request.url,
      });
    }

    const user = await container.identity.currentSession.resolve(sessionToken);
    if (!user) {
      throw new UnauthorizedError({
        reason: "auth.session_required",
        message: "Session is invalid or expired.",
        path: request.url,
      });
    }

    /**
     * The owners' door: what belongs to whoever runs the platform rather than
     * to whoever runs the school. The cargo is deliberately not consulted —
     * an `admin` of the Asociación is refused, an owner passes whatever cargo
     * their account carries (CLAUDE.md §5, §8).
     */
    if ("owners" in auth) {
      if (!isOwnerEmail(user.email)) {
        throw new NotAPlatformOwnerError({ path: request.url });
      }
    } else if ("permission" in auth) {
      // What the cargo holds, as administration last saved it (OOC-183).
      if (!auth.alsoRoles.includes(user.role) && !container.identity.staffAccess.has(user, auth.permission)) {
        throw new InsufficientPrivilegeError({ path: request.url });
      }
    } else if (!auth.roles.includes(user.role)) {
      throw new InsufficientPrivilegeError({ path: request.url });
    }

    /**
     * The second factor is not optional for master/admin/billing, nor for
     * any cargo holding a permission that moves money or hands out access
     * (CLAUDE.md §8, OOC-183). Once it is on, Better Auth itself never opens a session without
     * the code. This covers the account before that: a password alone still
     * opens a session there — an account that never enrolled, one just
     * promoted into the cargo — and that session reaches nothing but the
     * routes that turn the factor on.
     */
    if (container.identity.staffAccess.requiresMfa(user) && !user.twoFactorEnabled && !auth.beforeMfa) {
      throw new MfaEnrollmentRequiredError({ path: request.url });
    }

    request.currentUser = user;
    request.sessionToken = sessionToken;
  });
}

export default fp(authorizationPlugin);
