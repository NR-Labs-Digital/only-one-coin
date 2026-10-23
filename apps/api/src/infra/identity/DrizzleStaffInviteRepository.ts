import { staffInvites } from "@ooc/db";
import { and, eq } from "drizzle-orm";
import type { CreateStaffInviteRecord, IStaffInviteRepository, Role, StaffInvite } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";

type StaffInviteRow = typeof staffInvites.$inferSelect;

function toDomain(row: StaffInviteRow): StaffInvite {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role as Role,
    token: row.token,
    status: row.status as StaffInvite["status"],
    teacherId: row.teacherId,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleStaffInviteRepository implements IStaffInviteRepository {
  constructor(private readonly db: Db) {}

  async create(record: CreateStaffInviteRecord): Promise<StaffInvite> {
    const [row] = await this.db
      .insert(staffInvites)
      .values({
        email: record.email,
        firstName: record.firstName,
        lastName: record.lastName,
        role: record.role,
        token: record.token,
        invitedBy: record.invitedBy,
        teacherId: record.teacherId,
        expiresAt: record.expiresAt,
      })
      .returning();

    return toDomain(row!);
  }

  async findPendingByEmail(email: string): Promise<StaffInvite | null> {
    const [row] = await this.db
      .select()
      .from(staffInvites)
      .where(and(eq(staffInvites.email, email), eq(staffInvites.status, "pending")))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findPendingByTeacherId(teacherId: string): Promise<StaffInvite | null> {
    // Served by staff_invites_pending_teacher_uidx.
    const [row] = await this.db
      .select()
      .from(staffInvites)
      .where(and(eq(staffInvites.teacherId, teacherId), eq(staffInvites.status, "pending")))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<StaffInvite | null> {
    const [row] = await this.db.select().from(staffInvites).where(eq(staffInvites.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByToken(token: string): Promise<StaffInvite | null> {
    const [row] = await this.db.select().from(staffInvites).where(eq(staffInvites.token, token)).limit(1);
    return row ? toDomain(row) : null;
  }

  async markCompleted(id: string, completedUserId: string): Promise<void> {
    await this.db
      .update(staffInvites)
      .set({ status: "completed", completedUserId, updatedAt: new Date() })
      .where(eq(staffInvites.id, id));
  }

  async markCancelled(id: string): Promise<void> {
    await this.db
      .update(staffInvites)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(staffInvites.id, id));
  }

  async renew(id: string, expiresAt: Date): Promise<void> {
    await this.db.update(staffInvites).set({ expiresAt, updatedAt: new Date() }).where(eq(staffInvites.id, id));
  }
}
