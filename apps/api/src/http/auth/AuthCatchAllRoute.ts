import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IAuditLogRepository } from "@ooc/domain";
import type { Auth } from "@/infra/auth/betterAuth.js";
import { withoutTrustCookie, type TrustedBrowserGate } from "@/infra/auth/trustedBrowsers.js";
import { AUTH_SIGN_IN_BY_EMAIL, RATE_LIMITS } from "@/shared/http/rateLimit.js";

export interface AuthRouteDeps {
  trustedBrowsers: TrustedBrowserGate;
  auditLog: IAuditLogRepository;
}

export function registerAuthRoutes(app: FastifyInstance, auth: Auth, deps: AuthRouteDeps) {
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

      // "Remember this browser" (OOC-154) only for a cargo whose factor is
      // optional — checked by trustedBrowsers.ts at both ends: before the
      // password, whether this browser's cookie may skip the code; before the
      // code, whether the box may be honoured. Anywhere else the field is dropped.
      const path = url.pathname.replace(/\/+$/, "");
      const body = request.body as Record<string, unknown> | undefined;
      const cookieHeader = headers.get("cookie") ?? undefined;
      const isSignIn = path === SIGN_IN_PATH && request.method === "POST";
      const isCodeCheck = TRUST_DEVICE_PATHS.has(path) && request.method === "POST";

      const signInTrust = isSignIn ? await deps.trustedBrowsers.atSignIn(body?.email, cookieHeader) : null;
      if (signInTrust && !signInTrust.honour) {
        const kept = withoutTrustCookie(cookieHeader);
        if (kept) headers.set("cookie", kept);
        else headers.delete("cookie");
      }
      const trusting = isCodeCheck && body?.trustDevice === true && (await deps.trustedBrowsers.mayTrust(cookieHeader));

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(trusting ? request.body : withoutTrustDevice(request.body)) } : {}),
      });

      const response = await auth.handler(req);
      let bodyText = response.body ? await response.text() : null;

      // better-auth answers its own errors as {message, code}
      if (response.status >= 400) {
        return sendAsDomainError(reply, request, response.status, bodyText);
      }

      if (signInTrust?.honour && signInTrust.expiresAt) {
        await deps.trustedBrowsers.keepExpiry(response.headers.getSetCookie(), signInTrust.expiresAt);
      }
      if (signInTrust && bodyText) {
        // The code step offers the box only to an account that may tick it.
        // The password was right by now (no challenge otherwise), so saying
        // so tells nothing to someone who does not hold it.
        bodyText = withTrustOffer(bodyText, signInTrust.eligible);
      }
      if (trusting) {
        const userId = userIdOf(bodyText);
        if (userId) {
          await deps.auditLog.append({
            actorId: userId,
            action: "staff.browser_trusted",
            targetId: userId,
            metadata: {},
            at: new Date(),
          });
        }
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // The body may have been rewritten above; Fastify sets the length.
        if (key === "content-length") return;
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

const SIGN_IN_PATH = "/api/auth/sign-in/email";

/** Where ticking "remember this browser" is honoured — the code and the recovery code. */
const TRUST_DEVICE_PATHS = new Set(["/two-factor/verify-otp", "/two-factor/verify-backup-code"].map((p) => `/api/auth${p}`));

/** `twoFactorRedirect` answers gain `trustBrowser`: whether the code step shows the box. */
function withTrustOffer(bodyText: string, eligible: boolean): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("twoFactorRedirect" in parsed)) return bodyText;
    return JSON.stringify({ ...parsed, trustBrowser: eligible });
  } catch {
    return bodyText;
  }
}

function userIdOf(bodyText: string | null): string | null {
  try {
    const parsed = bodyText ? (JSON.parse(bodyText) as { user?: { id?: unknown } }) : null;
    return typeof parsed?.user?.id === "string" ? parsed.user.id : null;
  } catch {
    return null;
  }
}

/**
 * "Remember this browser" outside the two code checks, or for an account
 * whose cargo must type the code every time (OOC-154). Dropped from the body.
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
