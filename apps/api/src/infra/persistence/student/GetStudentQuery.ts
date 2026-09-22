import { consents, enrollments, guardians, students } from "@ooc/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { isMinor, type StudentStatus } from "./ListStudentsQuery.js";

export interface StudentGuardianRow {
  firstName: string;
  lastName: string;
  relationship: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  consent: { version: string; acceptedAt: Date; ip: string } | null;
}

export interface StudentDetailRow {
  id: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  birthDate: Date;
  country: string;
  region: string | null;
  city: string;
  createdAt: Date;
  isMinor: boolean;
  status: StudentStatus;
  activeCourses: number;
  totalEnrollments: number;
  lastActivityAt: Date;
  guardian: StudentGuardianRow | null;
}

/**
 * The student file — identity, contact and guardian, everything this table
 * actually models today. `StudentDetail` on the frontend
 * (`lib/backoffice/types.ts`) also carries documents, paid procedures,
 * uploaded attachments and an audit trail: none of those have a table yet
 * (`outbox`, `audit_log`, `materials`... are `docs/ROADMAP.md` Sessão 7, not
 * built), so this query does not return them — the route sends empty lists
 * rather than reaching for the old mock fixtures, since a real student found
 * through the real list has no mock counterpart to merge with.
 */
export class GetStudentQuery {
  constructor(private readonly db: Db) {}

  async run(studentId: string): Promise<StudentDetailRow | null> {
    const [student] = await this.db
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        nationalIdType: students.nationalIdType,
        nationalId: students.nationalId,
        email: students.email,
        phone: students.phone,
        birthDate: students.birthDate,
        country: students.country,
        region: students.region,
        city: students.city,
        createdAt: students.createdAt,
        updatedAt: students.updatedAt,
      })
      .from(students)
      .where(and(eq(students.id, studentId), isNull(students.deletedAt)));

    if (!student) {
      return null;
    }

    const [enrollmentStats] = await this.db
      .select({
        totalEnrollments: sql<number>`count(${enrollments.id})`.mapWith(Number),
        confirmedEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'confirmed')`.mapWith(
            Number,
          ),
        reservedEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'reserved')`.mapWith(
            Number,
          ),
        lastEnrollmentAt: sql<Date | null>`max(${enrollments.updatedAt})`,
      })
      .from(enrollments)
      // Retired enrollments are not part of what the student has going on
      // (CLAUDE.md §6).
      .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.deletedAt)));

    const [guardian] = await this.db
      .select({
        firstName: guardians.firstName,
        lastName: guardians.lastName,
        relationship: guardians.relationship,
        nationalIdType: guardians.nationalIdType,
        nationalId: guardians.nationalId,
        email: guardians.email,
        phone: guardians.phone,
      })
      .from(guardians)
      .where(and(eq(guardians.studentId, studentId), isNull(guardians.deletedAt)));

    let consent: StudentGuardianRow["consent"] = null;
    if (guardian) {
      const [latestConsent] = await this.db
        .select({ version: consents.version, acceptedAt: consents.acceptedAt, ip: consents.ip })
        .from(consents)
        .innerJoin(guardians, eq(guardians.id, consents.guardianId))
        .where(eq(guardians.studentId, studentId))
        .orderBy(desc(consents.acceptedAt))
        .limit(1);

      consent = latestConsent ?? null;
    }

    const stats = enrollmentStats ?? { totalEnrollments: 0, confirmedEnrollments: 0, reservedEnrollments: 0, lastEnrollmentAt: null };
    const status: StudentStatus =
      stats.confirmedEnrollments > 0 ? "active" : stats.reservedEnrollments > 0 ? "under_review" : "inactive";
    const lastActivityAt =
      stats.lastEnrollmentAt && stats.lastEnrollmentAt > student.updatedAt ? stats.lastEnrollmentAt : student.updatedAt;

    return {
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
      createdAt: student.createdAt,
      isMinor: isMinor(student.birthDate),
      status,
      activeCourses: stats.confirmedEnrollments,
      totalEnrollments: stats.totalEnrollments,
      lastActivityAt,
      guardian: guardian ? { ...guardian, consent } : null,
    };
  }
}
