import { sql } from "drizzle-orm";
import type { IStaffAccessRepository, RetirableStaffAccount } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

/**
 * Raw SQL against Better Auth's "banned"/"banReason"/"banExpires" columns
 * (added by the `admin` plugin's migration, see
 * packages/db/migrations/0007_*.sql) — not through `auth.api.banUser`/
 * `unbanUser`, which require an already-resolved admin session in Better
 * Auth's own request context (`use: [adminMiddleware]`, better-auth/dist/
 * plugins/admin/routes.mjs) that a domain-level port has no business
 * carrying. What actually enforces the ban is the plugin's own
 * `session.create` hook (better-auth/dist/plugins/admin/admin.mjs), which
 * reads these columns directly from the database on every sign-in — it does
 * not care how they were written, so a direct update here is enforced the
 * same as going through the plugin's API.
 */
export class DrizzleStaffAccessRepository implements IStaffAccessRepository {
  constructor(private readonly db: Db) {}

  async ban(userId: string, reason: string): Promise<boolean> {
    const result = await this.db.execute(
      sql`update "user" set "banned" = true, "banReason" = ${reason}, "updatedAt" = now()
          where "id" = ${userId} and "deletedAt" is null`,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async unban(userId: string): Promise<boolean> {
    const result = await this.db.execute(
      sql`update "user" set "banned" = false, "banReason" = null, "banExpires" = null, "updatedAt" = now()
          where "id" = ${userId} and "deletedAt" is null`,
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findRetirable(userId: string): Promise<RetirableStaffAccount | null> {
    const result = await this.db.execute<RetirableStaffAccount & Record<string, unknown>>(
      sql`select u."email" as "email", u."role" as "role",
            exists(select 1 from "teachers" t where t."user_id" = u."id" and t."deleted_at" is null) as "hasTeacherFile"
          from "user" u
          where u."id" = ${userId}
            and u."deletedAt" is null
            and u."role" not in ('student', 'guardian')`,
    );
    return result.rows[0] ?? null;
  }

  async retire(userId: string, retiredEmail: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`update "user"
            set "deletedAt" = now(), "email" = ${retiredEmail}, "banned" = true,
                "banReason" = 'staff_account_retired', "updatedAt" = now()
            where "id" = ${userId}
              and "deletedAt" is null
              and "role" not in ('student', 'guardian')`,
      );
      if ((result.rowCount ?? 0) === 0) return false;

      // No cookie cache or secondary storage: the row is the session
      // (BetterAuthStaffSessionRevoker).
      await tx.execute(sql`delete from "session" where "userId" = ${userId}`);
      return true;
    });
  }
}
