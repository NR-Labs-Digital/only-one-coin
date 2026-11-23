import {
  academicPeriods,
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  currentGrades,
  enrollments,
  guardians,
  issuedDocumentRevocations,
  issuedDocuments,
  procedureRequests,
  students,
} from "@ooc/db";
import {
  IssuedDocumentAlreadyRevokedError,
  issuedDocumentStatus,
  type EmailNotification,
  type IssuedDocument,
  type IssuedDocumentKind,
  type IssuedDocumentStatus,
  type WeeklySlot,
} from "@ooc/domain";
import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { enrollmentInModule } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { reachableStudentIdsSql } from "@/infra/persistence/portal/reachableStudents.js";

/** The actor of what the platform does on its own (the constancia, once paid). */
export const DOCUMENT_ISSUER_ACTOR = "system:documents";

/** Who an issued document is about, as the template and the e-mail read them. */
export interface IssuedStudentFacts {
  studentId: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  birthDate: Date;
  guardian: { firstName: string; email: string } | null;
}

export interface IssuedCourseFacts {
  name: string;
  language: string;
  level: string;
  totalHours: number;
}

/** A paid constancia request with nothing issued for it yet. */
export interface PendingConstancia extends IssuedStudentFacts {
  requestId: string;
  enrollmentId: string;
  course: IssuedCourseFacts;
  classGroup: { code: string; module: number | null; slots: WeeklySlot[]; startsOn: Date | null; endsOn: Date | null };
  periodName: string;
}

/** The module group a certificate batch is confirmed on, with its class group and course. */
export interface CertificateRun {
  id: string;
  module: number | null;
  fullCourse: boolean;
  retired: boolean;
  classGroup: { id: string; code: string; status: string; startsOn: Date | null; endsOn: Date | null; retired: boolean };
  course: IssuedCourseFacts & { modules: number; examRequired: boolean };
}

export type GradeRead = { score: number; didNotSit: false } | { score: null; didNotSit: true };

/** A confirmed seat in the batch's module group, with everything the rule reads. */
export interface CertificateSeat extends IssuedStudentFacts {
  enrollmentId: string;
  lastModuleGrade: GradeRead | null;
  earlierModuleGrades: { module: number; grade: GradeRead }[];
  /** The certificate that holds for this enrollment now — never a revoked one. */
  issued: { id: string; code: string; issuedAt: Date } | null;
  /** The revoked certificate nothing replaced yet (OOC-59): a new issue replaces it. */
  revokedId: string | null;
}

/** One document to record, its e-mails already built. */
export interface DocumentToRecord {
  id: string;
  code: string;
  studentId: string;
  enrollmentId: string;
  data: unknown;
  emails: EmailNotification[];
  /** The revoked document this one is issued in place of (OOC-59). */
  replacesId?: string | null;
}

export interface IssuedDocumentListItem {
  id: string;
  kind: IssuedDocumentKind;
  code: string;
  courseName: string;
  issuedAt: Date;
  status: IssuedDocumentStatus;
  revokedAt: Date | null;
}

/** What the public validation page may say about a code (OOC-59) — nothing else leaves. */
export interface PublicIssuedDocument {
  kind: IssuedDocumentKind;
  status: IssuedDocumentStatus;
  studentName: string;
  courseName: string;
  startsOn: string | null;
  endsOn: string | null;
  issuedAt: Date;
  revokedAt: Date | null;
}

// The outer row's id, qualified by hand: in a single-table select Drizzle
// writes a column without its table, and inside these subqueries a bare "id"
// would bind to the inner table (apps/api/CLAUDE.md, "Armadilha do Drizzle").
const OUTER_ID = sql.raw(`"issued_documents"."id"`);
/** When the document was revoked, or null. Correlated on the outer `issued_documents`. */
const revokedAtSql = sql<Date | string | null>`(select r.created_at from issued_document_revocations r where r.issued_document_id = ${OUTER_ID})`;
/** A later document was issued in its place. Correlated on the outer `issued_documents`. */
const replacedSql = sql<boolean>`exists (select 1 from issued_documents n where n.replaces_id = ${OUTER_ID})`;

const gradeOf = (row: { score: number | null; didNotSit: boolean }): GradeRead =>
  row.didNotSit ? { score: null, didNotSit: true } : { score: Number(row.score), didNotSit: false };

/** Postgres' unique_violation, wherever the driver nests it, with the constraint it hit. */
export function uniqueViolationOf(error: unknown): string | null {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const candidate = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
    if (candidate.code === "23505") {
      const name = candidate.constraint ?? candidate.constraint_name;
      return typeof name === "string" ? name : "";
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * The issued documents (OOC-33): what is waiting to be issued, the batch's
 * reads, the issuing transactions and the reads behind a download. Every
 * issue writes the document, its e-mails (outbox) and its audit entry in one
 * transaction — a document nobody heard of, or an e-mail about a document
 * that rolled back, never happens.
 */
export class DrizzleIssuedDocumentRepository {
  constructor(private readonly db: Db) {}

  /** Paid constancia requests with no document yet, oldest first. */
  async pendingConstancias(limit: number): Promise<PendingConstancia[]> {
    const rows = await this.db
      .select({
        requestId: procedureRequests.id,
        enrollmentId: procedureRequests.enrollmentId,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        nationalIdType: students.nationalIdType,
        nationalId: students.nationalId,
        email: students.email,
        birthDate: students.birthDate,
        guardianFirstName: guardians.firstName,
        guardianEmail: guardians.email,
        courseName: courses.name,
        language: courses.language,
        level: courses.level,
        totalHours: courses.totalHours,
        code: classGroups.code,
        module: classGroupModules.module,
        slots: classGroupModules.slots,
        startsOn: classGroups.startsOn,
        endsOn: classGroups.endsOn,
        periodName: academicPeriods.name,
      })
      .from(procedureRequests)
      .innerJoin(students, eq(students.id, procedureRequests.studentId))
      .leftJoin(guardians, and(eq(guardians.studentId, students.id), isNull(guardians.deletedAt)))
      .innerJoin(enrollments, eq(enrollments.id, procedureRequests.enrollmentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      // The run the student is in now (OOC-156); 0058's run shares the class group's id.
      .leftJoin(
        classGroupModules,
        eq(classGroupModules.id, sql`coalesce(${enrollments.classGroupModuleId}, ${enrollments.classGroupId})`),
      )
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .where(
        and(
          eq(procedureRequests.kind, "enrollment_certificate"),
          eq(procedureRequests.status, "paid"),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(issuedDocuments)
              .where(eq(issuedDocuments.procedureRequestId, procedureRequests.id)),
          ),
        ),
      )
      .orderBy(asc(procedureRequests.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      requestId: row.requestId,
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      firstName: row.firstName,
      lastName: row.lastName,
      nationalIdType: row.nationalIdType,
      nationalId: row.nationalId,
      email: row.email,
      birthDate: row.birthDate,
      guardian: row.guardianEmail ? { firstName: row.guardianFirstName ?? "", email: row.guardianEmail } : null,
      course: { name: row.courseName, language: row.language, level: row.level, totalHours: row.totalHours },
      classGroup: {
        code: row.code,
        module: row.module ?? null,
        slots: (row.slots ?? []) as WeeklySlot[],
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      },
      periodName: row.periodName,
    }));
  }

  /**
   * Records the constancia of one paid request: the document, the request
   * `paid → fulfilled` (conditional — 0 rows means somebody else issued it,
   * and nothing is written), the e-mails and the audit entry. False when the
   * request was no longer paid.
   */
  async recordConstancia(params: {
    requestId: string;
    templateVersionId: string;
    document: DocumentToRecord;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const moved = await tx
        .update(procedureRequests)
        .set({ status: "fulfilled", updatedAt: new Date() })
        .where(and(eq(procedureRequests.id, params.requestId), eq(procedureRequests.status, "paid")))
        .returning({ id: procedureRequests.id });
      if (moved.length === 0) return false;

      const { document } = params;
      await tx.insert(issuedDocuments).values({
        id: document.id,
        kind: "enrollment_certificate",
        code: document.code,
        studentId: document.studentId,
        enrollmentId: document.enrollmentId,
        procedureRequestId: params.requestId,
        templateVersionId: params.templateVersionId,
        data: document.data,
        issuedBy: null,
      });
      await insertOutboxEmails(tx, document.emails);
      await tx.insert(auditLog).values({
        actorId: DOCUMENT_ISSUER_ACTOR,
        action: "issued_document.issued",
        targetId: document.id,
        metadata: {
          kind: "enrollment_certificate",
          studentId: document.studentId,
          enrollmentId: document.enrollmentId,
          procedureRequestId: params.requestId,
        },
      });
      return true;
    });
  }

  /** The module group, if it belongs to the class group. */
  async certificateRun(classGroupId: string, moduleId: string): Promise<CertificateRun | null> {
    const [row] = await this.db
      .select({
        run: classGroupModules,
        group: classGroups,
        course: courses,
      })
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(and(eq(classGroupModules.id, moduleId), eq(classGroupModules.classGroupId, classGroupId)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.run.id,
      module: row.run.module,
      fullCourse: row.run.fullCourse,
      retired: row.run.deletedAt !== null,
      classGroup: {
        id: row.group.id,
        code: row.group.code,
        status: row.group.status,
        startsOn: row.group.startsOn,
        endsOn: row.group.endsOn,
        retired: row.group.deletedAt !== null,
      },
      course: {
        name: row.course.name,
        language: row.course.language,
        level: row.course.level,
        totalHours: row.course.totalHours,
        modules: row.course.modules,
        examRequired: row.course.certificateRule === "exam_required",
      },
    };
  }

  /**
   * Every confirmed, unretired seat in the module group now, with the current
   * attempt's grade here, the latest grade of each earlier module it has on
   * the platform (any class group — a moved student brings them along), and
   * the certificate already issued, if any. Ordered by name.
   */
  async certificateSeats(run: { id: string; module: number | null }): Promise<CertificateSeat[]> {
    const seats = await this.db
      .select({
        enrollmentId: enrollments.id,
        attempt: enrollments.moduleAttempt,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        nationalIdType: students.nationalIdType,
        nationalId: students.nationalId,
        email: students.email,
        birthDate: students.birthDate,
        guardianFirstName: guardians.firstName,
        guardianEmail: guardians.email,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .leftJoin(guardians, and(eq(guardians.studentId, students.id), isNull(guardians.deletedAt)))
      .where(and(enrollmentInModule(run.id), eq(enrollments.seatStatus, "confirmed"), isNull(enrollments.deletedAt)))
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));
    if (seats.length === 0) return [];
    const ids = seats.map((seat) => seat.enrollmentId);

    // Every grade of these seats that counts now (corrections applied), with
    // the module of the run it was posted in.
    const grades = await this.db
      .select({
        enrollmentId: currentGrades.enrollmentId,
        runId: currentGrades.classGroupModuleId,
        module: classGroupModules.module,
        attempt: currentGrades.attempt,
        score: currentGrades.score,
        didNotSit: currentGrades.didNotSit,
        recordedAt: currentGrades.recordedAt,
      })
      .from(currentGrades)
      .innerJoin(classGroupModules, eq(classGroupModules.id, currentGrades.classGroupModuleId))
      .where(inArray(currentGrades.enrollmentId, ids))
      .orderBy(asc(currentGrades.attempt), asc(currentGrades.recordedAt));

    // Every certificate of these seats, with whether it was revoked or
    // replaced. The one that holds is the one never revoked (OOC-59); the
    // revoked one nothing replaced is what a new issue replaces.
    const certificates = await this.db
      .select({
        id: issuedDocuments.id,
        enrollmentId: issuedDocuments.enrollmentId,
        code: issuedDocuments.code,
        issuedAt: issuedDocuments.issuedAt,
        revokedAt: revokedAtSql,
        replaced: replacedSql,
      })
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.kind, "certificate"), inArray(issuedDocuments.enrollmentId, ids)));
    const issuedOf = new Map(
      certificates.filter((row) => row.revokedAt === null).map((row) => [row.enrollmentId, row]),
    );
    const revokedOf = new Map(
      certificates.filter((row) => row.revokedAt !== null && !row.replaced).map((row) => [row.enrollmentId, row.id]),
    );

    return seats.map((seat) => {
      const own = grades.filter((grade) => grade.enrollmentId === seat.enrollmentId);
      const here = own.find((grade) => grade.runId === run.id && grade.attempt === seat.attempt);
      // The latest grade per earlier module: rows come in attempt, then time
      // order, so the last one written for a module wins.
      const earlier = new Map<number, GradeRead>();
      for (const grade of own) {
        if (grade.module === null || run.module === null || grade.module >= run.module) continue;
        earlier.set(grade.module, gradeOf(grade));
      }
      const document = issuedOf.get(seat.enrollmentId);
      return {
        enrollmentId: seat.enrollmentId,
        studentId: seat.studentId,
        firstName: seat.firstName,
        lastName: seat.lastName,
        nationalIdType: seat.nationalIdType,
        nationalId: seat.nationalId,
        email: seat.email,
        birthDate: seat.birthDate,
        guardian: seat.guardianEmail ? { firstName: seat.guardianFirstName ?? "", email: seat.guardianEmail } : null,
        lastModuleGrade: here ? gradeOf(here) : null,
        earlierModuleGrades: [...earlier.entries()]
          .sort(([a], [b]) => a - b)
          .map(([module, grade]) => ({ module, grade })),
        issued: document ? { id: document.id, code: document.code, issuedAt: document.issuedAt } : null,
        revokedId: document ? null : (revokedOf.get(seat.enrollmentId) ?? null),
      };
    });
  }

  /**
   * Records a batch of certificates in one transaction: every document, its
   * e-mails and audit entry, and the batch's own entry. A unique violation
   * (a code drawn twice, or a certificate somebody issued meanwhile) rolls the
   * whole batch back and is the caller's to retry.
   */
  async recordCertificates(params: {
    actorId: string;
    classGroupId: string;
    runId: string;
    templateVersionId: string;
    documents: DocumentToRecord[];
    examApprovedEnrollmentIds: string[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const at = new Date();
      await tx.insert(issuedDocuments).values(
        params.documents.map((document) => ({
          id: document.id,
          kind: "certificate",
          code: document.code,
          studentId: document.studentId,
          enrollmentId: document.enrollmentId,
          classGroupModuleId: params.runId,
          templateVersionId: params.templateVersionId,
          data: document.data,
          issuedBy: params.actorId,
          issuedAt: at,
          replacesId: document.replacesId ?? null,
        })),
      );
      await insertOutboxEmails(
        tx,
        params.documents.flatMap((document) => document.emails),
      );
      await tx.insert(auditLog).values([
        ...params.documents.map((document) => ({
          actorId: params.actorId,
          action: "issued_document.issued",
          targetId: document.id,
          metadata: {
            kind: "certificate",
            studentId: document.studentId,
            enrollmentId: document.enrollmentId,
            ...(document.replacesId ? { replacesId: document.replacesId } : {}),
          },
          createdAt: at,
        })),
        {
          actorId: params.actorId,
          action: "certificate.batch_issued",
          targetId: params.runId,
          // Ids only (CLAUDE.md §8); the exam marks are coordination's word, kept here.
          metadata: {
            classGroupId: params.classGroupId,
            classGroupModuleId: params.runId,
            documentIds: params.documents.map((document) => document.id),
            examApprovedEnrollmentIds: params.examApprovedEnrollmentIds,
          },
          createdAt: at,
        },
      ]);
    });
  }

  async findById(id: string): Promise<IssuedDocument | null> {
    const [row] = await this.db.select().from(issuedDocuments).where(eq(issuedDocuments.id, id)).limit(1);
    return row ? toDocument(row) : null;
  }

  /** The document, if it is about a file this portal account reaches (OOC-147). */
  async findForAccount(userId: string, id: string): Promise<IssuedDocument | null> {
    const [row] = await this.db
      .select()
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.id, id), sql`${issuedDocuments.studentId} in ${reachableStudentIdsSql(userId)}`))
      .limit(1);
    return row ? toDocument(row) : null;
  }

  /** The documents issued about these files, newest first. */
  async listForStudents(studentIds: string[]): Promise<IssuedDocumentListItem[]> {
    if (studentIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: issuedDocuments.id,
        kind: issuedDocuments.kind,
        code: issuedDocuments.code,
        courseName: courses.name,
        issuedAt: issuedDocuments.issuedAt,
        revokedAt: revokedAtSql,
        replaced: replacedSql,
      })
      .from(issuedDocuments)
      .innerJoin(enrollments, eq(enrollments.id, issuedDocuments.enrollmentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(inArray(issuedDocuments.studentId, studentIds))
      .orderBy(desc(issuedDocuments.issuedAt), desc(issuedDocuments.id));
    return rows.map(({ replaced, ...row }) => ({
      ...row,
      kind: row.kind as IssuedDocumentKind,
      revokedAt: toDate(row.revokedAt),
      status: issuedDocumentStatus({ revoked: row.revokedAt !== null, replaced }),
    }));
  }

  /** The document's status now (OOC-59), or null when there is no such document. */
  async statusOf(id: string): Promise<IssuedDocumentStatus | null> {
    const [row] = await this.db
      .select({ revokedAt: revokedAtSql, replaced: replacedSql })
      .from(issuedDocuments)
      .where(eq(issuedDocuments.id, id))
      .limit(1);
    return row ? issuedDocumentStatus({ revoked: row.revokedAt !== null, replaced: row.replaced }) : null;
  }

  /**
   * Revokes a document (OOC-59): the revocation row and its audit entry in one
   * transaction. The unique index on the document decides a second revocation
   * (two people at once included) — 409, nothing written. The reason stays in
   * the revocation row only: it is free text about a person (CLAUDE.md §8).
   */
  async revoke(params: { actorId: string; document: IssuedDocument; reason: string }): Promise<{ revocationId: string }> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(issuedDocumentRevocations)
          .values({ issuedDocumentId: params.document.id, reason: params.reason, revokedBy: params.actorId })
          .returning({ id: issuedDocumentRevocations.id });
        await tx.insert(auditLog).values({
          actorId: params.actorId,
          action: "issued_document.revoked",
          targetId: params.document.id,
          metadata: {
            kind: params.document.kind,
            studentId: params.document.studentId,
            enrollmentId: params.document.enrollmentId,
            revocationId: row!.id,
          },
        });
        return { revocationId: row!.id };
      });
    } catch (error) {
      if (uniqueViolationOf(error) === "issued_document_revocations_document_uidx") {
        throw new IssuedDocumentAlreadyRevokedError();
      }
      throw error;
    }
  }

  /**
   * The validation page's read (OOC-59): a code, stored form, to the public
   * fields alone — read from the data frozen on issue, so the page says what
   * the paper says. Never the document number, e-mail, grade or guardian.
   */
  async findPublicByCode(code: string): Promise<PublicIssuedDocument | null> {
    const [row] = await this.db
      .select({
        kind: issuedDocuments.kind,
        studentName: sql<string | null>`${issuedDocuments.data} #>> '{student,fullName}'`,
        courseName: sql<string | null>`${issuedDocuments.data} #>> '{course,name}'`,
        startsOn: sql<string | null>`nullif(${issuedDocuments.data} #>> '{classGroup,startsOn}', '')`,
        endsOn: sql<string | null>`nullif(${issuedDocuments.data} #>> '{classGroup,endsOn}', '')`,
        issuedAt: issuedDocuments.issuedAt,
        revokedAt: revokedAtSql,
        replaced: replacedSql,
      })
      .from(issuedDocuments)
      .where(eq(issuedDocuments.code, code))
      .limit(1);
    if (!row) return null;
    return {
      kind: row.kind as IssuedDocumentKind,
      status: issuedDocumentStatus({ revoked: row.revokedAt !== null, replaced: row.replaced }),
      studentName: row.studentName ?? "",
      courseName: row.courseName ?? "",
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      issuedAt: row.issuedAt,
      revokedAt: toDate(row.revokedAt),
    };
  }

  /** The live file exists. */
  async studentExists(studentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
      .limit(1);
    return row !== undefined;
  }
}

function toDocument(row: typeof issuedDocuments.$inferSelect): IssuedDocument {
  return {
    id: row.id,
    kind: row.kind as IssuedDocumentKind,
    code: row.code,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId,
    procedureRequestId: row.procedureRequestId,
    classGroupModuleId: row.classGroupModuleId,
    templateVersionId: row.templateVersionId,
    data: row.data,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt,
    replacesId: row.replacesId,
  };
}

/** A timestamp a raw subquery returns: the driver hands it over as text. */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}
