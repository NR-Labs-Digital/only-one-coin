import { Student, type IStudentRepository, type NationalIdType } from "@ooc/domain";
import { students } from "@ooc/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type StudentRow = typeof students.$inferSelect;

function toStudent(row: StudentRow): Student {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleStudentRepository implements IStudentRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Student | null> {
    const [row] = await this.db
      .select()
      .from(students)
      .where(and(eq(students.id, id), isNull(students.deletedAt)))
      .limit(1);

    return row ? toStudent(row) : null;
  }

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

    return row ? toStudent(row) : null;
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

    return toStudent(row);
  }

  async update(student: Student): Promise<Student> {
    const [row] = await this.db
      .update(students)
      .set({
        firstName: student.firstName,
        lastName: student.lastName,
        nationalIdType: student.nationalIdType,
        nationalId: student.nationalId,
        email: student.email,
        // The flag is about the address that bounced, not about the person.
        emailInvalidAt: sql`case when lower(${students.email}) = lower(${student.email}) then ${students.emailInvalidAt} else null end`,
        phone: student.phone,
        birthDate: student.birthDate,
        country: student.country,
        region: student.region,
        city: student.city,
        updatedAt: sql`now()`,
      })
      .where(and(eq(students.id, student.id), isNull(students.deletedAt)))
      .returning();

    if (!row) {
      throw new Error("Update of students matched no live row");
    }

    return toStudent(row);
  }
}
