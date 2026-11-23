import { sql } from "drizzle-orm";
import type { IStaffUserLookup, ResettableStaffUser, StaffUserDisplay } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

// Raw SQL, same reason as DrizzleUserRoleRepository — "user" is Better Auth's
// hand-rolled table, not modeled in packages/db/src/schema.ts.
export class DrizzleStaffUserLookup implements IStaffUserLookup {
  constructor(private readonly db: Db) {}

  async existsByEmail(email: string): Promise<boolean> {
    const result = await this.db.execute<{ exists: boolean }>(
      sql`select exists(select 1 from "user" where "email" = ${email}) as "exists"`,
    );
    return result.rows[0]?.exists ?? false;
  }

  async findDisplayByUserId(userId: string): Promise<StaffUserDisplay | null> {
    const result = await this.db.execute<StaffUserDisplay & Record<string, unknown>>(
      sql`select "name", "email" from "user" where "id" = ${userId}`,
    );
    return result.rows[0] ?? null;
  }

  async findResettableStaffByEmail(email: string): Promise<ResettableStaffUser | null> {
    // Same staff definition as ListStaffQuery (any cargo but student/guardian);
    // "banned" is how removing panel access is recorded (DrizzleStaffAccessRepository).
    const result = await this.db.execute<ResettableStaffUser & Record<string, unknown>>(
      sql`select "id", "name", "email", "role" from "user"
          where lower("email") = ${email}
            and "role" not in ('student', 'guardian')
            and "banned" = false
          limit 1`,
    );
    return result.rows[0] ?? null;
  }
}
