import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface StaffRoleChangeRow {
  id: string;
  at: Date;
  memberId: string;
  memberName: string;
  fromRole: string | null;
  toRole: string;
  /** Names of the cargos created in Equipo, when either side is `custom` (OOC-183). */
  fromProfileName: string | null;
  toProfileName: string | null;
  actorName: string;
  actorRole: string;
  actorProfileName: string | null;
}

// node-postgres, called through drizzle's raw `db.execute()`, returns
// timestamptz columns as strings, not Date (ListStaffQuery.ts carries the
// same note).
interface RawAuditRow extends Record<string, unknown> {
  id: string;
  createdAt: string;
  targetId: string;
  fromRole: string | null;
  toRole: string;
  fromProfileName: string | null;
  toProfileName: string | null;
  memberName: string | null;
  actorId: string;
  actorName: string | null;
  actorRole: string | null;
  actorProfileName: string | null;
}

/**
 * The cargo ledger — two kinds of `audit_log` row, both written the moment a
 * `role` was decided for an account:
 *
 * - `role.promote` (PromoteUserRoleUseCase): `target_id` is a real
 *   "user".id, so the join resolves both names.
 * - `staff.invite_created` (CreateStaffInviteUseCase): `target_id` is the
 *   invite's own id, not a "user".id — nothing to join, so the invitee's name
 *   travels in `metadata` itself and is read from there instead.
 *
 * A member or actor who has since been removed from "user" entirely still
 * shows by id — the log outlives the account it names (CLAUDE.md §8).
 */
export class ListStaffRoleChangesQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<StaffRoleChangeRow[]> {
    const result = await this.db.execute<RawAuditRow>(sql`
      select
        a."id" as "id",
        a."created_at" as "createdAt",
        a."target_id" as "targetId",
        a."metadata"->>'fromRole' as "fromRole",
        coalesce(a."metadata"->>'newRole', a."metadata"->>'role') as "toRole",
        from_profile."name" as "fromProfileName",
        to_profile."name" as "toProfileName",
        coalesce(target."name", trim(concat(a."metadata"->>'firstName', ' ', a."metadata"->>'lastName'))) as "memberName",
        a."actor_id" as "actorId",
        actor."name" as "actorName",
        actor."role" as "actorRole",
        actor_profile."name" as "actorProfileName"
      from "audit_log" a
      left join "user" target on target."id" = a."target_id"
      left join "user" actor on actor."id" = a."actor_id"
      left join "staff_profiles" from_profile on from_profile."id"::text = a."metadata"->>'fromProfileId'
      left join "staff_profiles" to_profile
        on to_profile."id"::text = coalesce(a."metadata"->>'newProfileId', a."metadata"->>'profileId')
      left join "staff_profiles" actor_profile on actor_profile."id" = actor."profile_id"
      where a."action" in ('role.promote', 'staff.invite_created')
      order by a."created_at" desc
    `);

    return result.rows.map((row) => ({
      id: row.id,
      at: new Date(row.createdAt),
      memberId: row.targetId,
      memberName: row.memberName?.trim() || row.targetId,
      fromRole: row.fromRole,
      toRole: row.toRole,
      fromProfileName: row.fromProfileName,
      toProfileName: row.toProfileName,
      actorName: row.actorName?.trim() || row.actorId,
      actorRole: row.actorRole ?? "admin",
      actorProfileName: row.actorProfileName,
    }));
  }
}
