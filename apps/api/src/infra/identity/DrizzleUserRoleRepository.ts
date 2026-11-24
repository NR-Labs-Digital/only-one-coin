import { sql } from "drizzle-orm";
import type { IUserRoleRepository, Role, UserRoleAssignment } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

// Raw SQL against Better Auth's own "user" table — same reason
// apps/api/src/scripts/seed-admin.ts already uses raw SQL there instead of a
// Drizzle schema object: that table is hand-rolled by Better Auth
// (packages/db/migrations/0001_better_auth_core.sql), not modeled in
// packages/db/src/schema.ts.
export class DrizzleUserRoleRepository implements IUserRoleRepository {
  constructor(private readonly db: Db) {}

  async findAssignmentByUserId(userId: string): Promise<UserRoleAssignment | null> {
    const rows = await this.db.execute<{ role: Role; profile_id: string | null }>(
      sql`select "role", "profile_id" from "user" where "id" = ${userId}`,
    );
    const row = rows.rows[0];
    return row ? { role: row.role, profileId: row.profile_id } : null;
  }

  /** Role and cargo move in one statement: `user_profile_check` holds them together. */
  async updateAssignment(userId: string, assignment: UserRoleAssignment): Promise<void> {
    await this.db.execute(
      sql`update "user" set "role" = ${assignment.role}, "profile_id" = ${assignment.profileId}, "updatedAt" = now() where "id" = ${userId}`,
    );
  }
}
