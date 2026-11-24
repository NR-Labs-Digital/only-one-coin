import { staffPermissionSeeds, staffProfilePermissions, staffProfiles } from "@ooc/db";
import {
  BOARD_ROLES,
  LOCKED_ROLES,
  PERMISSION_CATALOG,
  isGrantable,
  isPermissionKey,
  type BoardRole,
  type IStaffProfileRepository,
  type PermissionKey,
  type StaffProfileListing,
  type StaffProfileRecord,
} from "@ooc/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Row = { id: string; roleKey: string | null; name: string | null };

/** Stored keys the catalog no longer knows are skipped, never handed to the screen. */
function knownKeys(keys: readonly string[]): PermissionKey[] {
  return keys.filter(isPermissionKey);
}

/**
 * The cargos (OOC-183). The board's rows are written on boot by `syncBoard`
 * — the permission catalog is code, so its defaults land from the code, once
 * per permission key.
 */
export class DrizzleStaffProfileRepository implements IStaffProfileRepository {
  constructor(private readonly db: Db) {}

  /** Every live cargo with its stored permissions — what the access registry loads. */
  async loadLive(): Promise<StaffProfileRecord[]> {
    const profiles = await this.db
      .select({ id: staffProfiles.id, roleKey: staffProfiles.roleKey, name: staffProfiles.name })
      .from(staffProfiles)
      .where(isNull(staffProfiles.deletedAt));
    const grants = await this.db
      .select({ profileId: staffProfilePermissions.profileId, permission: staffProfilePermissions.permission })
      .from(staffProfilePermissions);
    const byProfile = new Map<string, string[]>();
    for (const grant of grants) {
      const list = byProfile.get(grant.profileId) ?? [];
      list.push(grant.permission);
      byProfile.set(grant.profileId, list);
    }
    return profiles.map((row) => this.record(row, byProfile.get(row.id) ?? []));
  }

  async listLive(): Promise<StaffProfileListing[]> {
    const records = await this.loadLive();
    const counts = await this.db.execute<{ profile_id: string | null; role: string; members: number }>(sql`
      select "profile_id", "role", count(*)::int as "members" from (
        select "profile_id", "role" from "user"
         where "deletedAt" is null and "role" not in ('student', 'guardian')
        union all
        select "profile_id", "role" from "staff_invites" where "status" = 'pending'
      ) as m
      group by "profile_id", "role"
    `);
    const byProfile = new Map<string, number>();
    const byRole = new Map<string, number>();
    for (const row of counts.rows) {
      if (row.profile_id) byProfile.set(row.profile_id, row.members);
      else byRole.set(row.role, row.members);
    }
    return records.map((record) => ({
      ...record,
      members: record.role ? (byRole.get(record.role) ?? 0) : (byProfile.get(record.id) ?? 0),
    }));
  }

  async findLiveById(id: string): Promise<StaffProfileRecord | null> {
    const [row] = await this.db
      .select({ id: staffProfiles.id, roleKey: staffProfiles.roleKey, name: staffProfiles.name })
      .from(staffProfiles)
      .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)));
    return row ? this.record(row, await this.permissionsOf(row.id)) : null;
  }

  async findByRole(role: BoardRole): Promise<StaffProfileRecord | null> {
    const [row] = await this.db
      .select({ id: staffProfiles.id, roleKey: staffProfiles.roleKey, name: staffProfiles.name })
      .from(staffProfiles)
      .where(eq(staffProfiles.roleKey, role));
    return row ? this.record(row, await this.permissionsOf(row.id)) : null;
  }

  async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    const rows = await this.db.execute<{ id: string }>(sql`
      select "id" from "staff_profiles"
       where "deleted_at" is null and lower("name") = lower(${name})
         ${exceptId ? sql`and "id" <> ${exceptId}` : sql``}
       limit 1
    `);
    return rows.rows.length > 0;
  }

  async create(input: { name: string; permissions: PermissionKey[]; createdBy: string }): Promise<StaffProfileRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(staffProfiles)
        .values({ name: input.name, createdBy: input.createdBy })
        .returning({ id: staffProfiles.id, roleKey: staffProfiles.roleKey, name: staffProfiles.name });
      if (input.permissions.length > 0) {
        await tx
          .insert(staffProfilePermissions)
          .values(input.permissions.map((permission) => ({ profileId: row!.id, permission })));
      }
      return this.record(row!, input.permissions);
    });
  }

  async update(id: string, input: { name?: string; permissions: PermissionKey[] }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(staffProfiles)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), updatedAt: new Date() })
        .where(eq(staffProfiles.id, id));
      await tx.delete(staffProfilePermissions).where(eq(staffProfilePermissions.profileId, id));
      if (input.permissions.length > 0) {
        await tx
          .insert(staffProfilePermissions)
          .values(input.permissions.map((permission) => ({ profileId: id, permission })));
      }
    });
  }

  async retire(id: string): Promise<void> {
    await this.db
      .update(staffProfiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)));
  }

  async countMembers(id: string): Promise<number> {
    const rows = await this.db.execute<{ members: number }>(sql`
      select (
        (select count(*) from "user" where "profile_id" = ${id} and "deletedAt" is null)
        + (select count(*) from "staff_invites" where "profile_id" = ${id} and "status" = 'pending')
      )::int as "members"
    `);
    return rows.rows[0]?.members ?? 0;
  }

  /**
   * Brings the board up to the code (OOC-183), idempotent and safe for two
   * machines booting at once: a row per board cargo, and every permission key
   * not seeded yet granted to the cargos its catalog entry names — once.
   * Master and teacher are locked: theirs is read from the code, never stored.
   */
  async syncBoard(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(staffProfiles)
        .values(BOARD_ROLES.map((roleKey) => ({ roleKey })))
        .onConflictDoNothing({ target: staffProfiles.roleKey });

      const seeded = new Set(
        (await tx.select({ permission: staffPermissionSeeds.permission }).from(staffPermissionSeeds)).map(
          (row) => row.permission,
        ),
      );
      const fresh = PERMISSION_CATALOG.filter((entry) => !seeded.has(entry.key));
      if (fresh.length === 0) return;

      const board = await tx
        .select({ id: staffProfiles.id, roleKey: staffProfiles.roleKey })
        .from(staffProfiles)
        .where(sql`${staffProfiles.roleKey} is not null`);
      const idOf = new Map(board.map((row) => [row.roleKey!, row.id]));
      const locked = new Set<string>(LOCKED_ROLES);

      // Only what a cargo is handed is stored: the teacher portal is the
      // locked teacher's, an account's own settings are everyone's.
      const grants = fresh.flatMap((entry) =>
        (isGrantable(entry.key) ? (entry.defaultRoles as readonly string[]) : [])
          .filter((role) => !locked.has(role) && idOf.has(role))
          .map((role) => ({ profileId: idOf.get(role)!, permission: entry.key })),
      );
      if (grants.length > 0) await tx.insert(staffProfilePermissions).values(grants).onConflictDoNothing();
      await tx
        .insert(staffPermissionSeeds)
        .values(fresh.map((entry) => ({ permission: entry.key })))
        .onConflictDoNothing();
    });
  }

  private async permissionsOf(id: string): Promise<string[]> {
    const rows = await this.db
      .select({ permission: staffProfilePermissions.permission })
      .from(staffProfilePermissions)
      .where(eq(staffProfilePermissions.profileId, id));
    return rows.map((row) => row.permission);
  }

  private record(row: Row, permissions: readonly string[]): StaffProfileRecord {
    return {
      id: row.id,
      role: (row.roleKey as BoardRole | null) ?? null,
      name: row.name,
      permissions: knownKeys(permissions),
    };
  }
}
