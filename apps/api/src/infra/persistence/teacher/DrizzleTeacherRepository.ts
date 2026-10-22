import { classGroups, teacherAvailability, teacherLanguages, teachers } from "@ooc/db";
import {
  Teacher,
  TeacherAlreadyRegisteredError,
  type ITeacherRepository,
  type NationalIdType,
  type TeacherStatus,
  type WeeklySlot,
} from "@ooc/domain";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

type TeacherRow = typeof teachers.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Postgres `time` reads back as `HH:mm:ss`; the domain speaks `HH:mm`. */
export function toHourMinute(time: string): string {
  return time.slice(0, 5);
}

function toTeacher(row: TeacherRow, languages: string[], availability: WeeklySlot[]): Teacher {
  return new Teacher({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalIdType: row.nationalIdType as NationalIdType,
    nationalId: row.nationalId,
    email: row.email,
    phone: row.phone,
    nationality: row.nationality,
    country: row.country,
    region: row.region,
    city: row.city,
    addressLine: row.addressLine,
    status: row.status as TeacherStatus,
    userId: row.userId,
    languages,
    availability,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

/**
 * The teacher aggregate over its three tables (OOC-78). Languages and
 * availability are lists rewritten as a whole when the file is saved — the
 * history that matters (who ran a class group) lives on `class_groups.teacher_id`,
 * so these two tables carry no delete lock (0025).
 */
export class DrizzleTeacherRepository implements ITeacherRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Teacher | null> {
    const [row] = await this.db
      .select()
      .from(teachers)
      .where(and(eq(teachers.id, id), isNull(teachers.deletedAt)))
      .limit(1);

    return row ? this.hydrate(this.db, row) : null;
  }

  async findByNationalId(params: { nationalIdType: NationalIdType; nationalId: string }): Promise<Teacher | null> {
    // Served by teachers_national_id_uidx (partial, deleted_at is null).
    const [row] = await this.db
      .select()
      .from(teachers)
      .where(
        and(
          eq(teachers.nationalIdType, params.nationalIdType),
          eq(teachers.nationalId, params.nationalId),
          isNull(teachers.deletedAt),
        ),
      )
      .limit(1);

    return row ? this.hydrate(this.db, row) : null;
  }

  async create(teacher: Teacher): Promise<Teacher> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(teachers)
          .values({
            id: teacher.id,
            ...this.columns(teacher),
          })
          .returning();

        if (!row) throw new Error("Insert into teachers returned no row");

        await this.writeLists(tx, teacher);
        return this.hydrate(tx, row);
      });
    } catch (error) {
      // Two people registering the same document at the same instant: the
      // usecase's read let both through, the unique index lets one.
      if (isUniqueViolation(error, "teachers_national_id_uidx")) throw new TeacherAlreadyRegisteredError({ cause: error });
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<Teacher | null> {
    // Served by teachers_user_id_uidx.
    const [row] = await this.db
      .select()
      .from(teachers)
      .where(and(eq(teachers.userId, userId), isNull(teachers.deletedAt)))
      .limit(1);

    return row ? this.hydrate(this.db, row) : null;
  }

  async linkAccount(teacherId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(teachers)
      .set({ userId, updatedAt: sql`now()` })
      .where(and(eq(teachers.id, teacherId), isNull(teachers.userId), isNull(teachers.deletedAt)))
      .returning({ id: teachers.id });

    return rows.length > 0;
  }

  async update(teacher: Teacher): Promise<Teacher> {
    try {
      return await this.db.transaction(async (tx) => {
        // `user_id` stays out: only linkAccount writes it, so a file read
        // before an invite was accepted cannot unlink the account on save.
        const { userId: _account, ...fields } = this.columns(teacher);
        const [row] = await tx
          .update(teachers)
          .set({ ...fields, updatedAt: sql`now()` })
          .where(and(eq(teachers.id, teacher.id), isNull(teachers.deletedAt)))
          .returning();

        if (!row) throw new Error("Update of teachers matched no live row");

        await tx.delete(teacherLanguages).where(eq(teacherLanguages.teacherId, teacher.id));
        await tx.delete(teacherAvailability).where(eq(teacherAvailability.teacherId, teacher.id));
        await this.writeLists(tx, teacher);
        return this.hydrate(tx, row);
      });
    } catch (error) {
      if (isUniqueViolation(error, "teachers_national_id_uidx")) throw new TeacherAlreadyRegisteredError({ cause: error });
      throw error;
    }
  }

  async countRunningClassGroups(teacherId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(classGroups)
      .where(
        and(
          eq(classGroups.teacherId, teacherId),
          inArray(classGroups.status, ["enrolling", "in_progress"]),
          isNull(classGroups.deletedAt),
        ),
      );

    return row?.total ?? 0;
  }

  private columns(teacher: Teacher) {
    return {
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      nationalIdType: teacher.nationalIdType,
      nationalId: teacher.nationalId,
      email: teacher.email,
      phone: teacher.phone,
      nationality: teacher.nationality,
      country: teacher.country,
      region: teacher.region,
      city: teacher.city,
      addressLine: teacher.addressLine,
      status: teacher.status,
      userId: teacher.userId,
    };
  }

  private async writeLists(tx: Tx, teacher: Teacher): Promise<void> {
    if (teacher.languages.length > 0) {
      await tx
        .insert(teacherLanguages)
        .values(teacher.languages.map((language) => ({ teacherId: teacher.id, language })));
    }
    if (teacher.availability.length > 0) {
      await tx.insert(teacherAvailability).values(
        teacher.availability.map((slot) => ({
          teacherId: teacher.id,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      );
    }
  }

  private async hydrate(db: Db | Tx, row: TeacherRow): Promise<Teacher> {
    // One after the other: inside create/update this runs on the
    // transaction's single client, which must not take two queries at once.
    const languages = await db
      .select({ language: teacherLanguages.language })
      .from(teacherLanguages)
      .where(eq(teacherLanguages.teacherId, row.id))
      .orderBy(asc(teacherLanguages.language));
    const availability = await db
      .select({
        weekday: teacherAvailability.weekday,
        startTime: teacherAvailability.startTime,
        endTime: teacherAvailability.endTime,
      })
      .from(teacherAvailability)
      .where(eq(teacherAvailability.teacherId, row.id))
      .orderBy(asc(teacherAvailability.weekday), asc(teacherAvailability.startTime));

    return toTeacher(
      row,
      languages.map((item) => item.language),
      availability.map((slot) => ({
        weekday: slot.weekday as WeeklySlot["weekday"],
        startTime: toHourMinute(slot.startTime),
        endTime: toHourMinute(slot.endTime),
      })),
    );
  }
}
