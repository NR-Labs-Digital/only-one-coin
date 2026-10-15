import type { AuthenticatedUser, ICurrentSessionPort, Role } from "@ooc/domain";
import { SESSION_COOKIE_NAME, type Auth } from "@/infra/auth/betterAuth.js";

export class BetterAuthCurrentSessionPort implements ICurrentSessionPort {
  constructor(private readonly auth: Auth) {}

  async resolve(sessionToken: string): Promise<AuthenticatedUser | null> {
    // Better Auth's internal session route reads the cookie via
    // ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ...)
    // (better-auth/dist/api/routes/session.mjs) — an exact-name, signature-
    // verifying lookup, not the dual-fallback getCookie() helper used
    // elsewhere in the package. In production that exact name is
    // __Secure-{SESSION_COOKIE_NAME} (https baseURL). Sending both means
    // this works regardless of which one Better Auth's internals expect,
    // without duplicating its own secure-cookie-detection logic here.
    const session = await this.auth.api.getSession({
      headers: new Headers({
        cookie: `__Secure-${SESSION_COOKIE_NAME}=${sessionToken}; ${SESSION_COOKIE_NAME}=${sessionToken}`,
      }),
    });

    if (!session) {
      return null;
    }

    const { user } = session;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user as unknown as { role: Role }).role,
      // Read from the row on every request like `role` — no cookie cache is
      // configured, so turning the factor on or off is seen on the next call.
      twoFactorEnabled: user.twoFactorEnabled === true,
    };
  }
}
