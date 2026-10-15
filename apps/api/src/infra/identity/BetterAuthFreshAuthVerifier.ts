import { sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import type { IFreshAuthVerifier } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

/**
 * Confirms the acting user's own password again, right now — the plugin
 * `admin` do Better Auth não garante isso sozinho (CLAUDE.md §8). Checks the
 * typed password against the credential row's hash with Better Auth's own
 * verifier (`better-auth/crypto`, the hasher `credentialAccount.ts` writes
 * with).
 *
 * It used to call `auth.api.signInEmail` and discard the result. That minted a
 * session on every check — left open in the "session" table, and counted as a
 * sign-in by the team directory — and, once the account has the second factor
 * on (OOC-29), a sign-in no longer returns a session at all: it opens a
 * code challenge instead. A password check is not a sign-in.
 */
export class BetterAuthFreshAuthVerifier implements IFreshAuthVerifier {
  constructor(private readonly db: Db) {}

  async verify(userId: string, plainPassword: string): Promise<boolean> {
    const rows = await this.db.execute<{ password: string | null }>(sql`
      select a."password" as "password"
      from "account" a
      join "user" u on u."id" = a."userId"
      where a."userId" = ${userId}
        and a."providerId" = 'credential'
        and coalesce(u."banned", false) = false
    `);
    const hash = rows.rows[0]?.password;
    if (!hash || !plainPassword) {
      return false;
    }

    try {
      return await verifyPassword({ hash, password: plainPassword });
    } catch {
      return false;
    }
  }
}
