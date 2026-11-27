import { sql, type SQL } from "drizzle-orm";
import type { IStaffTrustedBrowsers, Role } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";
import type { StaffAccessRegistry } from "@/infra/identity/StaffAccessRegistry.js";

/**
 * "Remember this browser" for the staff second factor (OOC-154).
 *
 * Better Auth's `twoFactor` plugin does the mechanics: ticking the box at the
 * code (`trustDevice: true` on `/two-factor/verify-otp`) stores a
 * `trust-device-<random>` row in "verification" (value = the user id) and a
 * signed `trust_device` cookie pointing at it; a later password sign-in from
 * that browser with a live row skips the code — and rotates the row.
 *
 * What the plugin does not know is the cargo. A cargo whose factor is
 * mandatory (master, admin, billing, and any cargo holding a sensitive
 * permission — CLAUDE.md §8) is never remembered: the auth catch-all asks
 * this gate before both moments and drops `trustDevice`, or the cookie,
 * when the account must type the code every time. Checking at sign-in, not
 * only when trusting, is what covers an account promoted after it ticked the
 * box. The plugin also pushes the row forward on every sign-in; the gate
 * keeps the first expiry, so the window is the one the box promised.
 */

/** Better Auth's cookie names (prefix "better-auth", plus `__Secure-` over https). */
const TRUST_COOKIE = "better-auth.trust_device";
const CHALLENGE_COOKIE = "better-auth.two_factor";

/** Every row the plugin keeps for a trusted browser. */
const TRUST_ROW_PREFIX = "trust-device-";

/**
 * Forgets every trusted browser of the account — for the account screen, and
 * for whatever already ends its sessions: own password change, password reset,
 * blocking, retiring, turning the factor off. Usable inside a transaction.
 */
export function forgetTrustedBrowsersSql(userId: string): SQL {
  return sql`delete from "verification" where "value" = ${userId} and "identifier" like ${`${TRUST_ROW_PREFIX}%`}`;
}

export class DrizzleStaffTrustedBrowsers implements IStaffTrustedBrowsers {
  constructor(private readonly db: Db) {}

  async count(userId: string): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`select count(*)::int as "count" from "verification"
          where "value" = ${userId} and "identifier" like ${`${TRUST_ROW_PREFIX}%`} and "expiresAt" > now()`,
    );
    return result.rows[0]?.count ?? 0;
  }

  async forgetAll(userId: string): Promise<number> {
    const result = await this.db.execute(forgetTrustedBrowsersSql(userId));
    return result.rowCount ?? 0;
  }
}

interface StaffAccount {
  id: string;
  role: Role;
  profileId: string | null;
}

export interface SignInTrust {
  /** The account may be remembered: a staff cargo whose factor is optional. */
  eligible: boolean;
  /** The browser's trust cookie is live, the account's, and may be honoured. */
  honour: boolean;
  /** The trusted row's expiry — kept when the plugin rotates the row. */
  expiresAt: Date | null;
}

export class TrustedBrowserGate {
  constructor(
    private readonly db: Db,
    private readonly staffAccess: StaffAccessRegistry,
  ) {}

  /** Before `/sign-in/email`: may this account be remembered, and may this browser's cookie count? */
  async atSignIn(email: unknown, cookieHeader: string | undefined): Promise<SignInTrust> {
    const account = typeof email === "string" ? await this.accountByEmail(email) : null;
    const eligible = account !== null && this.eligible(account);

    const identifier = trustIdentifierOf(cookieValue(cookieHeader, TRUST_COOKIE));
    if (!eligible || !identifier) return { eligible, honour: false, expiresAt: null };

    const row = await this.verificationRow(identifier);
    const honour = row !== null && row.value === account.id && row.expiresAt > new Date();
    return { eligible, honour, expiresAt: honour ? row.expiresAt : null };
  }

  /**
   * Before `/two-factor/verify-*` with the box ticked: the challenge cookie
   * names the account (a "verification" row whose value is the user id).
   * A forged cookie only gets the box dropped — the plugin refuses it anyway.
   */
  async mayTrust(cookieHeader: string | undefined): Promise<boolean> {
    const identifier = challengeIdentifierOf(cookieValue(cookieHeader, CHALLENGE_COOKIE));
    if (!identifier) return false;
    const row = await this.verificationRow(identifier);
    if (!row) return false;
    const account = await this.accountById(row.value);
    return account !== null && this.eligible(account);
  }

  /** After a sign-in the cookie opened: the rotated row keeps the first expiry. */
  async keepExpiry(setCookies: string[], expiresAt: Date): Promise<void> {
    const header = setCookies.find((cookie) => cookieName(cookie).endsWith(TRUST_COOKIE));
    const identifier = trustIdentifierOf(header ? decodeURIComponent(header.split(";")[0]!.split("=").slice(1).join("=")) : null);
    if (!identifier) return;
    await this.db.execute(
      sql`update "verification" set "expiresAt" = least("expiresAt", ${expiresAt.toISOString()}::timestamptz)
          where "identifier" = ${identifier}`,
    );
  }

  private eligible(account: StaffAccount): boolean {
    if (account.role === "student" || account.role === "guardian") return false;
    return !this.staffAccess.requiresMfa(account);
  }

  private async accountByEmail(email: string): Promise<StaffAccount | null> {
    const result = await this.db.execute<StaffAccount & Record<string, unknown>>(
      sql`select "id", "role", "profile_id" as "profileId" from "user"
          where lower("email") = ${email.trim().toLowerCase()} and "deletedAt" is null
          limit 1`,
    );
    return result.rows[0] ?? null;
  }

  private async accountById(userId: string): Promise<StaffAccount | null> {
    const result = await this.db.execute<StaffAccount & Record<string, unknown>>(
      sql`select "id", "role", "profile_id" as "profileId" from "user"
          where "id" = ${userId} and "deletedAt" is null`,
    );
    return result.rows[0] ?? null;
  }

  private async verificationRow(identifier: string): Promise<{ value: string; expiresAt: Date } | null> {
    const result = await this.db.execute<{ value: string; expiresAt: Date | string }>(
      sql`select "value", "expiresAt" from "verification" where "identifier" = ${identifier} limit 1`,
    );
    const row = result.rows[0];
    return row ? { value: row.value, expiresAt: new Date(row.expiresAt) } : null;
  }
}

/** The `Cookie` header without the trust cookie — the plugin then asks for the code. */
export function withoutTrustCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return cookieHeader;
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !cookieName(part).endsWith(TRUST_COOKIE))
    .join("; ");
}

function cookieName(cookie: string): string {
  return cookie.split("=")[0]!.trim();
}

/** A cookie's decoded value; both `name` and `__Secure-name` count. */
function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name || rawName === `__Secure-${name}`) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Signed cookies are `<value>.<signature>`; the plugin's random part is
// a-z, A-Z, 0-9, "-" and "_" (better-auth/crypto `generateRandomString`).

/** The trust cookie's value is `<hmac>!trust-device-<random>`. */
function trustIdentifierOf(value: string | null): string | null {
  return value?.match(/!(trust-device-[A-Za-z0-9_-]+)\./)?.[1] ?? null;
}

/** The challenge cookie's value is `2fa-<random>`. */
function challengeIdentifierOf(value: string | null): string | null {
  return value?.match(/^(2fa-[A-Za-z0-9_-]+)\./)?.[1] ?? null;
}
