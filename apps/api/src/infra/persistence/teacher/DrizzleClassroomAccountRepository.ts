import { classroomAccounts, teachers } from "@ooc/db";
import {
  ClassroomAccount,
  ClassroomAccountExistsError,
  ClassroomAccountInUseError,
  type IClassroomAccountRepository,
} from "@ooc/domain";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

/** One live account per e-mail, ignoring case (migration 0081). */
export const CLASSROOM_ACCOUNT_EMAIL_INDEX = "classroom_accounts_email_live_uidx";

function emailRace(error: unknown): never {
  if (isUniqueViolation(error, CLASSROOM_ACCOUNT_EMAIL_INDEX)) throw new ClassroomAccountExistsError({ cause: error });
  throw error;
}

export function classroomAccountFromRow(row: typeof classroomAccounts.$inferSelect): ClassroomAccount {
  return new ClassroomAccount({
    id: row.id,
    email: row.email,
    passwordCiphertext: row.passwordCiphertext,
    passwordChangedAt: row.passwordChangedAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

/** The shared Classroom logins (OOC-196). */
export class DrizzleClassroomAccountRepository implements IClassroomAccountRepository {
  constructor(private readonly db: Db) {}

  async create(account: ClassroomAccount): Promise<void> {
    await this.db
      .insert(classroomAccounts)
      .values({
        id: account.id,
        email: account.email,
        passwordCiphertext: account.passwordCiphertext,
        passwordChangedAt: account.passwordChangedAt,
      })
      .catch(emailRace);
  }

  async findById(id: string): Promise<ClassroomAccount | null> {
    const [row] = await this.db
      .select()
      .from(classroomAccounts)
      .where(and(eq(classroomAccounts.id, id), isNull(classroomAccounts.deletedAt)))
      .limit(1);
    return row ? classroomAccountFromRow(row) : null;
  }

  async update(account: ClassroomAccount): Promise<void> {
    await this.db
      .update(classroomAccounts)
      .set({
        email: account.email,
        passwordCiphertext: account.passwordCiphertext,
        passwordChangedAt: account.passwordChangedAt,
        updatedAt: sql`now()`,
      })
      .where(and(eq(classroomAccounts.id, account.id), isNull(classroomAccounts.deletedAt)))
      .catch(emailRace);
  }

  async countTeachers(id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(teachers)
      .where(and(eq(teachers.classroomAccountId, id), isNull(teachers.deletedAt)));
    return row?.total ?? 0;
  }

  /**
   * Under the account's row lock — the one a teacher write takes to hand out
   * a place (DrizzleTeacherRepository) — so a teacher given the account while
   * it was being retired either lands first and stops the retire, or finds it
   * gone.
   */
  async retire(account: ClassroomAccount): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: classroomAccounts.id })
        .from(classroomAccounts)
        .where(eq(classroomAccounts.id, account.id))
        .for("update");
      const [row] = await tx
        .select({ total: count() })
        .from(teachers)
        .where(and(eq(teachers.classroomAccountId, account.id), isNull(teachers.deletedAt)));
      if ((row?.total ?? 0) > 0) throw new ClassroomAccountInUseError();
      await tx
        .update(classroomAccounts)
        .set({ deletedAt: account.deletedAt, updatedAt: sql`now()` })
        .where(eq(classroomAccounts.id, account.id));
    });
  }
}
