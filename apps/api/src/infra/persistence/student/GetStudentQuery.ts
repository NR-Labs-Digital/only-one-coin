import { classGroups, consents, enrollments, guardians, students } from "@ooc/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { currentClassGroupSql, deriveStudentStatus, isMinor, type StudentStatus } from "./ListStudentsQuery.js";

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
  /** Set by the Brevo webhook on a hard bounce to `email`; null otherwise. */
  emailInvalidAt: Date | null;
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
 * The student file's identity half — contact, guardian and consent. The rest
 * of the file is read by its neighbours: the enrollment history by
 * `StudentEnrollmentHistoryQuery` (OOC-73) and the activity timeline, out of
 * `audit_log`, by `StudentActivityQuery` (OOC-75). Issued documents, paid
 * procedures and uploaded attachments have no table yet (OOC-33), so the
 * route sends those as empty lists rather than reaching for mock fixtures.
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
        emailInvalidAt: students.emailInvalidAt,
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
        currentEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'confirmed' and ${currentClassGroupSql})`.mapWith(
            Number,
          ),
        reservedEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'reserved')`.mapWith(
            Number,
          ),
        lastEnrollmentAt: sql<Date | null>`max(${enrollments.updatedAt})`,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
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

    const stats = enrollmentStats ?? {
      totalEnrollments: 0,
      confirmedEnrollments: 0,
      currentEnrollments: 0,
      reservedEnrollments: 0,
      lastEnrollmentAt: null,
    };
    // The same derivation as the directory (OOC-116), so the badge on the
    // file and the tab the student is listed under always agree.
    const status: StudentStatus = deriveStudentStatus({
      confirmed: stats.confirmedEnrollments,
      current: stats.currentEnrollments,
      reserved: stats.reservedEnrollments,
    });
    const lastActivityAt =
      stats.lastEnrollmentAt && stats.lastEnrollmentAt > student.updatedAt ? stats.lastEnrollmentAt : student.updatedAt;

    return {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      nationalIdType: student.nationalIdType,
      nationalId: student.nationalId,
      email: student.email,
      emailInvalidAt: student.emailInvalidAt,
      phone: student.phone,
      birthDate: student.birthDate,
      country: student.country,
      region: student.region,
      city: student.city,
      createdAt: student.createdAt,
      isMinor: isMinor(student.birthDate),
      status,
      activeCourses: stats.currentEnrollments,
      totalEnrollments: stats.totalEnrollments,
      lastActivityAt,
      guardian: guardian ? { ...guardian, consent } : null,
    };
  }
}
