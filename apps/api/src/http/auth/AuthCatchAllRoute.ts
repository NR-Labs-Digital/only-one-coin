import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth } from "@/infra/auth/betterAuth.js";
import { AUTH_SIGN_IN_BY_EMAIL, RATE_LIMITS } from "@/shared/http/rateLimit.js";

export function registerAuthRoutes(app: FastifyInstance, auth: Auth) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    // better-auth is its own auth system underneath this catch-all (login,
    // signup, session refresh...) — necessarily reachable without a session
    // already established. Still subject to the deny-by-default onRoute
    // check (CLAUDE.md §6), so it must declare itself explicitly public.
    // Same for the rate limit (CLAUDE.md §6): per IP, since there is no
    // account to count against before sign-in, plus a per-e-mail ceiling on
    // sign-in: for the account under attack rather than the address attacking it.
    config: { auth: { public: true }, rateLimit: [RATE_LIMITS.auth, AUTH_SIGN_IN_BY_EMAIL] },
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);

      if (CLOSED_TWO_FACTOR_PATHS.has(url.pathname)) {
        request.log.info({ path: url.pathname }, "closed better-auth endpoint refused");
        return reply.status(404).send({ status: 404, reason: "auth.endpoint_closed", path: request.url });
      }

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(withoutTrustDevice(request.body)) } : {}),
      });

      const response = await auth.handler(req);
      const bodyText = response.body ? await response.text() : null;

      // better-auth answers its own errors as {message, code}
      if (response.status >= 400) {
        return sendAsDomainError(reply, request, response.status, bodyText);
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(bodyText);
    },
  });
}

/**
 * The `twoFactor` plugin's own management endpoints (OOC-29). Turning the
 * factor on and off and re-issuing recovery codes go through apps/api's
 * `/api/v1/me/mfa` routes — where the cargo rule lives (master, admin and
 * billing cannot turn it off, CLAUDE.md §8) and every change reaches
 * audit_log. Left open, `/two-factor/disable` would be a way around both.
 * The TOTP ones are closed because authenticator apps are not offered.
 *
 * What stays open is the sign-in challenge: `/two-factor/send-otp`,
 * `/two-factor/verify-otp` and `/two-factor/verify-backup-code`.
 */
const CLOSED_TWO_FACTOR_PATHS = new Set(
  [
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/generate-backup-codes",
    "/two-factor/get-totp-uri",
    "/two-factor/verify-totp",
  ].map((path) => `/api/auth${path}`),
);

/**
 * "Trust this browser" would let a password alone open the panel again from
 * that browser for 30 days — the second factor asked once a month, not on
 * every sign-in. Dropped from every body, whatever endpoint it was sent to.
 */
function withoutTrustDevice(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("trustDevice" in body)) {
    return body;
  }
  const { trustDevice: _dropped, ...rest } = body as Record<string, unknown>;
  return rest;
}

function sendAsDomainError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  bodyText: string | null,
) {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = bodyText ? (JSON.parse(bodyText) as { code?: string; message?: string }) : null;
    code = parsed?.code;
    message = parsed?.message;
  } catch {
    // better-auth always answers errors as JSON; an unparsable body falls
    // through to the 500 branch below like any other unexpected failure.
  }

  if (status >= 500 || !code) {
    request.log.error({ status, code, message, reqId: request.id }, "better-auth error");
    return reply.status(500).send({ status: 500, reason: "internal_error", errorId: request.id });
  }

  request.log.info({ status, code }, "better-auth rejected request");
  return reply.status(status).send({
    status,
    reason: `auth.${code.toLowerCase()}`,
    path: request.url,
  });
}
