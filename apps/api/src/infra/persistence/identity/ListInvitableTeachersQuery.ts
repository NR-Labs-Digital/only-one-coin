import { staffInvites, teachers } from "@ooc/db";
import { and, asc, eq, isNull, notExists } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export interface InvitableTeacher {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * The teacher picker of the staff invite form (OOC-79): live files on the
 * roster that can still receive a panel account — no `user_id` yet and no
 * invite already open for them. Name and e-mail only, to fill the form; the
 * same rules are checked again by CreateStaffInviteUseCase.
 */
export class ListInvitableTeachersQuery {
  constructor(private readonly db: Db) {}

  async run(): Promise<InvitableTeacher[]> {
    return this.db
      .select({ id: teachers.id, firstName: teachers.firstName, lastName: teachers.lastName, email: teachers.email })
      .from(teachers)
      .where(
        and(
          eq(teachers.status, "active"),
          isNull(teachers.userId),
          isNull(teachers.deletedAt),
          notExists(
            this.db
              .select({ id: staffInvites.id })
              .from(staffInvites)
              .where(and(eq(staffInvites.teacherId, teachers.id), eq(staffInvites.status, "pending"))),
          ),
        ),
      )
      .orderBy(asc(teachers.lastName), asc(teachers.firstName), asc(teachers.id));
  }
}
