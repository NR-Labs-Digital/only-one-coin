import type { Role } from "../Role.js";

export interface StaffInvite {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  token: string;
  status: "pending" | "completed" | "cancelled";
  /** The teacher file a `teacher` invite opens an account for (OOC-79); null for every other cargo. */
  teacherId: string | null;
  expiresAt: Date;
}

export interface CreateStaffInviteRecord {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  token: string;
  invitedBy: string;
  teacherId: string | null;
  expiresAt: Date;
}

export interface IStaffInviteRepository {
  create(record: CreateStaffInviteRecord): Promise<StaffInvite>;
  findPendingByEmail(email: string): Promise<StaffInvite | null>;
  findPendingByTeacherId(teacherId: string): Promise<StaffInvite | null>;
  findById(id: string): Promise<StaffInvite | null>;
  findByToken(token: string): Promise<StaffInvite | null>;
  markCompleted(id: string, completedUserId: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
  renew(id: string, expiresAt: Date): Promise<void>;
}
