import { staffInvites, staffProfiles } from "@ooc/db";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { notDemoTeacher } from "@/infra/persistence/demoRows.js";
import { splitName } from "@/infra/identity/splitName.js";

export type StaffStatus = "active" | "invited" | "inactive";

export interface StaffMemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  /** The cargo created in Equipo, for a `custom` account or invite (OOC-183). */
  profileId: string | null;
  profileName: string | null;
  status: StaffStatus;
  teacherId: string | null;
  mfaEnrolled: boolean;
  joinedAt: Date;
  lastAccessAt: Date | null;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
}

// node-postgres, called through drizzle's raw `db.execute()`, returns
// timestamptz columns as strings, not Date — unlike a typed `.select()`
// against a schema.ts table (where Drizzle does that conversion itself).
interface StaffUserRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  role: string;
  profileId: string | null;
  profileName: string | null;
  banned: boolean;
  twoFactorEnabled: boolean;
  teacherId: string | null;
  createdAt: string;
  lastAccessAt: string | null;
}

/**
 * The team directory: real accounts (Better Auth's own "user" table — raw
 * SQL, same reasoning as DrizzleUserRoleRepository) plus pending invites
 * (staff_invites, our own table). A read shaped for one screen with no
 * invariant to protect, so it lives here rather than in packages/domain,
 * same call `ListStudentsQuery` already makes.
 *
 * `teacherId` is the teacher file the account belongs to (`teachers.user_id`)
 * or the one the invite names (OOC-79); null for every other cargo, and for a
 * `teacher` account nothing links — a finding the team screen shows.
 * `mfaEnrolled` is the account's `twoFactorEnabled` (OOC-29); an invite has no
 * account yet, so it is always false there.
 */
export class ListStaffQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<StaffMemberRow[]> {
    const usersResult = await this.db.execute<StaffUserRow>(sql`
      select
        u."id" as "id",
        u."name" as "name",
        u."email" as "email",
        u."role" as "role",
        u."profile_id" as "profileId",
        p."name" as "profileName",
        u."banned" as "banned",
        u."twoFactorEnabled" as "twoFactorEnabled",
        t."id" as "teacherId",
        u."createdAt" as "createdAt",
        (select max(s."createdAt") from "session" s where s."userId" = u."id") as "lastAccessAt"
      from "user" u
      left join "teachers" t on t."user_id" = u."id" and t."deleted_at" is null
      left join "staff_profiles" p on p."id" = u."profile_id"
      where u."role" not in ('student', 'guardian')
        and u."deletedAt" is null
        -- A demo teacher's account (28/11/2026) is not part of the team.
        and (t."id" is null or not t."is_demo")
    `);

    const staffRows: StaffMemberRow[] = usersResult.rows.map((row) => {
      const { firstName, lastName } = splitName(row.name);
      return {
        id: row.id,
        firstName,
        lastName,
        email: row.email,
        role: row.role,
        profileId: row.profileId,
        profileName: row.profileName,
        status: row.banned ? "inactive" : "active",
        teacherId: row.teacherId,
        mfaEnrolled: row.twoFactorEnabled,
        joinedAt: new Date(row.createdAt),
        lastAccessAt: row.lastAccessAt ? new Date(row.lastAccessAt) : null,
        inviteToken: null,
        inviteExpiresAt: null,
      };
    });

    const inviteRows = await this.db
      .select()
      .from(staffInvites)
      .where(and(eq(staffInvites.status, "pending"), notDemoTeacher(staffInvites.teacherId)));
    const profileNames = new Map(
      (
        await this.db
          .select({ id: staffProfiles.id, name: staffProfiles.name })
          .from(staffProfiles)
          .where(sql`${staffProfiles.name} is not null`)
      ).map((row) => [row.id, row.name]),
    );

    const invitedRows: StaffMemberRow[] = inviteRows.map((invite) => ({
      id: invite.id,
      firstName: invite.firstName,
      lastName: invite.lastName,
      email: invite.email,
      role: invite.role,
      profileId: invite.profileId,
      profileName: invite.profileId ? (profileNames.get(invite.profileId) ?? null) : null,
      status: "invited",
      teacherId: invite.teacherId,
      mfaEnrolled: false,
      joinedAt: invite.createdAt,
      lastAccessAt: null,
      inviteToken: invite.token,
      inviteExpiresAt: invite.expiresAt,
    }));

    return [...staffRows, ...invitedRows].sort(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    );
  }
}
