import { Student, type IStudentRepository, type NationalIdType } from "@ooc/domain";
import { students } from "@ooc/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export class DrizzleStudentRepository implements IStudentRepository {
  constructor(private readonly db: Db) {}

  async findByNationalId(params: {
    nationalIdType: NationalIdType;
    nationalId: string;
  }): Promise<Student | null> {
    // Served by students_national_id_type_national_id_idx (packages/db
    // schema.ts) — the same index pair the unique constraint will use.
    const [row] = await this.db
      .select()
      .from(students)
      .where(
        and(
          eq(students.nationalIdType, params.nationalIdType),
          eq(students.nationalId, params.nationalId),
          // A retired record does not answer for the person any more
          // (CLAUDE.md §6 — soft delete is the only delete there is).
          isNull(students.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return new Student({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      nationalIdType: row.nationalIdType as NationalIdType,
      nationalId: row.nationalId,
      email: row.email,
      phone: row.phone,
      birthDate: row.birthDate,
      country: row.country,
      region: row.region,
      city: row.city,
    });
  }

  async create(student: Student): Promise<Student> {
    const [row] = await this.db
      .insert(students)
      .values({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        nationalIdType: student.nationalIdType,
        nationalId: student.nationalId,
        email: student.email,
        phone: student.phone,
        birthDate: student.birthDate,
        country: student.country,
        region: student.region,
        city: student.city,
      })
      .returning();

    if (!row) {
      throw new Error("Insert into students returned no row");
    }

    return new Student({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      nationalIdType: row.nationalIdType as NationalIdType,
      nationalId: row.nationalId,
      email: row.email,
      phone: row.phone,
      birthDate: row.birthDate,
      country: row.country,
      region: row.region,
      city: row.city,
    });
  }
}
