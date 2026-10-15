import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { admin, openAPI, twoFactor } from "better-auth/plugins";
import { LocaleSchema, STAFF_MFA_CODE_TTL_MINUTES, type Locale } from "@ooc/domain";
import type { Config } from "@/config.js";
import { recoveryCodeCipher } from "@/infra/auth/recoveryCodes.js";

// Default cookie better-auth sets for the session token — "{prefix}.session_token",
// prefix "better-auth" unless overridden below. Keep in sync if `advanced.cookiePrefix`
// or `useSecureCookies` ever changes (docs/ARCHITECTURE.md §5.6).
export const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Which language the second-factor e-mail is written in. Better Auth's
 * `/two-factor/send-otp` takes no body field for it, so the panel names it in
 * this header; anything missing or unknown falls back to es-PE (CLAUDE.md §4).
 */
export const LOCALE_HEADER = "x-ooc-locale";

export interface TwoFactorCodeSender {
  send(input: { userId: string; email: string; name: string; code: string; locale: Locale }): Promise<void>;
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * `codeSender` is optional only for the Better Auth CLI (`apps/api/auth.ts`),
 * which reads the plugins to know the schema and never sends anything. The
 * container always passes one.
 */
export function createAuth(config: Config, deps: { codeSender?: TwoFactorCodeSender } = {}) {
  const { codeSender } = deps;

  return betterAuth({
    database: new Pool({ connectionString: config.DATABASE_URL }),
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    // In dev/test also trust this process's own origin so the merged Swagger
    // UI (/docs, served by apps/api itself, not through the apps/app proxy)
    // can "try it out" against /api/auth/* without an origin mismatch.
    trustedOrigins:
      config.NODE_ENV === "production"
        ? config.APP_PUBLIC_URLS
        : [...config.APP_PUBLIC_URLS, `http://localhost:${config.PORT}`],
    emailAndPassword: {
      enabled: true,
      // No self sign-up, staff or student (CLAUDE.md §1): every account is
      // created by apps/api (infra/auth/credentialAccount.ts). Before this
      // the public POST /api/auth/sign-up/email created a `student` account
      // for anyone who called it.
      disableSignUp: true,
    },
    plugins: [
      openAPI({ disableDefaultReference: config.NODE_ENV === "production" }),
      // Enables Better Auth's own sign-in-blocking hook for a banned account
      // (CLAUDE.md §8, "remover acesso ao painel"). Its `banUser`/`unbanUser`
      // API routes are not used — apps/api writes `banned` directly
      // (DrizzleStaffAccessRepository), which this plugin's own
      // `session.create` hook enforces regardless of how the column was set.
      //
      // `defaultRole` must match `additionalFields.role.defaultValue` below:
      // the plugin's own `user.create.before` hook writes its `defaultRole`
      // into the row ahead of our own default being applied, so leaving it at
      // the plugin's own default ("user") fails "user"."role"'s CHECK
      // constraint (only the roles in packages/domain/src/identity/Role.ts
      // are valid) on every sign-up — caught by actually completing an invite
      // end to end, not by reading the plugin's source.
      admin({ defaultRole: "student" }),
      // The staff second factor (OOC-29, CLAUDE.md §8): an e-mailed code.
      // Once `twoFactorEnabled` is set on an account, the plugin's hook after
      // `/sign-in/email` deletes the session the password just created and
      // answers `twoFactorRedirect` instead — no session exists until
      // `/two-factor/verify-otp` (or `/verify-backup-code`) succeeds.
      //
      // Turning it on, off and re-issuing recovery codes go through apps/api's
      // own `/api/v1/me/mfa` routes, never the plugin's endpoints — the auth
      // catch-all refuses those (AuthCatchAllRoute.ts) so a cargo that must
      // keep the factor cannot drop it, and every change lands in audit_log.
      twoFactor({
        issuer: "Only One Coin",
        // E-mail only for now — no authenticator app (decision of 14/10/2026).
        totpOptions: { disable: true },
        otpOptions: {
          period: STAFF_MFA_CODE_TTL_MINUTES,
          storeOTP: "hashed",
          allowedAttempts: 5,
          ...(codeSender && {
            sendOTP: async ({ user, otp }, ctx) => {
              const header = ctx?.headers?.get(LOCALE_HEADER);
              const locale = LocaleSchema.safeParse(header).data ?? "es-PE";
              await codeSender.send({ userId: user.id, email: user.email, name: user.name, code: otp, locale });
            },
          }),
        },
        backupCodeOptions: { storeBackupCodes: recoveryCodeCipher(config.BETTER_AUTH_SECRET) },
        // A "trust this browser for 30 days" cookie would let a password
        // alone open the panel again from that browser. The catch-all also
        // strips `trustDevice` from every request; this keeps any cookie
        // minted anyway from outliving one sign-in window.
        trustDeviceMaxAge: 1,
      }),
    ],
    user: {
      additionalFields: {
        // The "role" field is required for all users, but it is not exposed to the user
        role: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "student",
        },
      },
    },
  });
}
