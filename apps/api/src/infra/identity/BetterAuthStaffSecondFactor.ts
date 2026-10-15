import { randomUUID } from "node:crypto";
import type {
  ConfirmMfaEnrollmentResult,
  IStaffSecondFactor,
  Locale,
  MfaCodeFailure,
  StaffMfaState,
} from "@ooc/domain";
import { APIError } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { LOCALE_HEADER, SESSION_COOKIE_NAME, type Auth } from "@/infra/auth/betterAuth.js";
import { generateRecoveryCodes, type RecoveryCodeCipher } from "@/infra/auth/recoveryCodes.js";
import type { Db } from "@/infra/db/client.js";

/** Better Auth's error codes for a code that did not work, and what each one means to the panel. */
const CODE_FAILURES: Record<string, MfaCodeFailure> = {
  INVALID_CODE: "staff_mfa.code_invalid",
  OTP_HAS_EXPIRED: "staff_mfa.code_expired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "staff_mfa.code_attempts_exhausted",
};

/**
 * The second factor on Better Auth's `twoFactor` plugin. Sending and checking
 * the enrollment code go through the plugin's own endpoints, called
 * server-side with the person's session — so the code is bound to that
 * session, and the plugin is the one that flips `twoFactorEnabled` and
 * replaces the session. The recovery codes and turning the factor off are
 * written here directly, on Better Auth's tables (raw SQL, same reasoning as
 * `DrizzleUserRoleRepository`), with the same cipher the plugin is configured
 * to read them back with (`recoveryCodes.ts`).
 */
export class BetterAuthStaffSecondFactor implements IStaffSecondFactor {
  constructor(
    private readonly auth: Auth,
    private readonly db: Db,
    private readonly cipher: RecoveryCodeCipher,
  ) {}

  async state(userId: string): Promise<StaffMfaState> {
    const rows = await this.db.execute<{ enabled: boolean; backupCodes: string | null }>(sql`
      select u."twoFactorEnabled" as "enabled", t."backupCodes" as "backupCodes"
      from "user" u
      left join "twoFactor" t on t."userId" = u."id"
      where u."id" = ${userId}
    `);
    const row = rows.rows[0];
    if (!row) return { enabled: false, recoveryCodesLeft: 0 };

    return { enabled: row.enabled, recoveryCodesLeft: row.backupCodes ? await this.countCodes(row.backupCodes) : 0 };
  }

  async sendEnrollmentCode(sessionToken: string, locale: Locale): Promise<void> {
    await this.auth.api.sendTwoFactorOTP({ headers: this.sessionHeaders(sessionToken, locale) });
  }

  async confirmEnrollment(sessionToken: string, code: string): Promise<ConfirmMfaEnrollmentResult> {
    try {
      const { headers } = await this.auth.api.verifyTwoFactorOTP({
        body: { code },
        headers: this.sessionHeaders(sessionToken),
        returnHeaders: true,
      });
      return { ok: true, sessionCookies: headers.getSetCookie() };
    } catch (error) {
      const failure = error instanceof APIError ? CODE_FAILURES[String(error.body?.code)] : undefined;
      if (failure) return { ok: false, reason: failure };
      throw error;
    }
  }

  async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    const encrypted = await this.cipher.encrypt(JSON.stringify(codes));
    // The plugin's TOTP column is required; authenticator apps are off, so
    // this is an encrypted random value nobody reads back (0029).
    const unusedSecret = await this.cipher.encrypt(generateRandomString(32));

    await this.db.execute(sql`
      insert into "twoFactor" ("id", "secret", "backupCodes", "userId", "verified")
      values (${randomUUID()}, ${unusedSecret}, ${encrypted}, ${userId}, true)
      on conflict ("userId") do update set "backupCodes" = excluded."backupCodes"
    `);
    return codes;
  }

  async disable(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`update "user" set "twoFactorEnabled" = false, "updatedAt" = now() where "id" = ${userId}`);
      await tx.execute(sql`delete from "twoFactor" where "userId" = ${userId}`);
    });
  }

  private async countCodes(stored: string): Promise<number> {
    try {
      const codes: unknown = JSON.parse(await this.cipher.decrypt(stored));
      return Array.isArray(codes) ? codes.length : 0;
    } catch {
      // Unreadable (a rotated secret): as good as none — the screen offers new ones.
      return 0;
    }
  }

  // Same dual cookie as BetterAuthCurrentSessionPort: Better Auth reads the
  // exact name, which is `__Secure-` prefixed under an https baseURL.
  private sessionHeaders(sessionToken: string, locale?: Locale): Headers {
    const headers = new Headers({
      cookie: `__Secure-${SESSION_COOKIE_NAME}=${sessionToken}; ${SESSION_COOKIE_NAME}=${sessionToken}`,
    });
    if (locale) headers.set(LOCALE_HEADER, locale);
    return headers;
  }
}
