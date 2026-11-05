import type { EmailNotification } from "../../notification/EmailNotification.js";
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
  /** Writes the invite and the e-mails `notify` builds from it in one transaction. */
  create(record: CreateStaffInviteRecord, notify: (invite: StaffInvite) => EmailNotification[]): Promise<StaffInvite>;
  findPendingByEmail(email: string): Promise<StaffInvite | null>;
  findPendingByTeacherId(teacherId: string): Promise<StaffInvite | null>;
  findById(id: string): Promise<StaffInvite | null>;
  findByToken(token: string): Promise<StaffInvite | null>;
  markCompleted(id: string, completedUserId: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
  renew(id: string, expiresAt: Date): Promise<void>;
}
