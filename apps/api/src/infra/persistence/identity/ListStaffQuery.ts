import { staffInvites } from "@ooc/db";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { splitName } from "@/infra/identity/splitName.js";

export type StaffStatus = "active" | "invited" | "inactive";

export interface StaffMemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
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
  banned: boolean;
  twoFactorEnabled: boolean;
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
 * `teacherId` is always null — nothing links a panel account to a teacher
 * record yet (GetCurrentStaffRoute.ts documents the same gap), so it is not
 * faked here. `mfaEnrolled` is the account's `twoFactorEnabled` (OOC-29); an
 * invite has no account yet, so it is always false there.
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
        u."banned" as "banned",
        u."twoFactorEnabled" as "twoFactorEnabled",
        u."createdAt" as "createdAt",
        (select max(s."createdAt") from "session" s where s."userId" = u."id") as "lastAccessAt"
      from "user" u
      where u."role" not in ('student', 'guardian')
    `);

    const staffRows: StaffMemberRow[] = usersResult.rows.map((row) => {
      const { firstName, lastName } = splitName(row.name);
      return {
        id: row.id,
        firstName,
        lastName,
        email: row.email,
        role: row.role,
        status: row.banned ? "inactive" : "active",
        teacherId: null,
        mfaEnrolled: row.twoFactorEnabled,
        joinedAt: new Date(row.createdAt),
        lastAccessAt: row.lastAccessAt ? new Date(row.lastAccessAt) : null,
        inviteToken: null,
        inviteExpiresAt: null,
      };
    });

    const inviteRows = await this.db.select().from(staffInvites).where(eq(staffInvites.status, "pending"));

    const invitedRows: StaffMemberRow[] = inviteRows.map((invite) => ({
      id: invite.id,
      firstName: invite.firstName,
      lastName: invite.lastName,
      email: invite.email,
      role: invite.role,
      status: "invited",
      teacherId: null,
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
