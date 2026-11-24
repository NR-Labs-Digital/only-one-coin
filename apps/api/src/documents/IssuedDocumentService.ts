import { randomUUID } from "node:crypto";
import {
  CatalogClassGroupNotFoundError,
  CertificateNothingToIssueError,
  CertificateRunNotLastModuleError,
  DocumentTemplateNotPublishedError,
  IssuedDocumentAlreadyRevokedError,
  IssuedDocumentNotFoundError,
  IssuedDocumentRevocationReasonRequiredError,
  REVOCATION_REASON_MAX_LENGTH,
  certificateBlockReason,
  closesTheCourse,
  issuedDocumentEmails,
  newDocumentCode,
  normalizeDocumentCode,
  type CertificateBlockReason,
  type IAuditLogRepository,
  type IDocumentTemplateRepository,
  type IPlatformSettingsRepository,
  type IssuedDocument,
} from "@ooc/domain";
import {
  uniqueViolationOf,
  type CertificateRun,
  type CertificateSeat,
  type DocumentToRecord,
  type DrizzleIssuedDocumentRepository,
  type GradeRead,
  type PendingConstancia,
  type PublicIssuedDocument,
} from "@/infra/persistence/document/DrizzleIssuedDocumentRepository.js";
import { scheduleTextFromSlots } from "@/infra/persistence/catalog/scheduleText.js";
import { DocumentMissingValueError, type DocumentPreviewService } from "./DocumentPreviewService.js";
import type { CertificateData } from "./kinds/certificate.js";
import type { EnrollmentCertificateData } from "./kinds/enrollmentCertificate.js";
import { issuedCourse, issuedStudent, limaDay, org } from "./kinds/issuedDocumentData.js";
import { todayInLima } from "./kinds/teacherContract.js";
import { verificationQrDataUri, verificationUrl } from "./verificationQr.js";

/** How many times a write that hit a unique index is tried again with fresh codes. */
const MAX_ATTEMPTS = 3;

export interface CertificatePreviewItem {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  lastModuleGrade: GradeRead | null;
  /** Why the certificate does not go out now; null = it does. For a course
   * with the certification exam, `exam_not_approved` means "coordination can
   * mark it in the batch". */
  blockReason: CertificateBlockReason | null;
  issued: { id: string; code: string; issuedAt: Date } | null;
}

export interface CertificatePreview {
  /** The module group is the course's last module — the only one a batch is confirmed on. */
  closesTheCourse: boolean;
  examRequired: boolean;
  /** The certificate's template has a published version; without one nothing can be issued. */
  templatePublished: boolean;
  items: CertificatePreviewItem[];
}

export interface IssuedPdf {
  pdf: Uint8Array;
  code: string;
}

/**
 * Issuing and printing the institution's documents (OOC-33). The document is
 * recorded with the published template version and its data frozen; the PDF
 * is printed from those on every download and never stored, like the teacher
 * contract (OOC-124). Every document carries a verification code (the public
 * validation page is OOC-59).
 *
 * - The constancia is issued on its own once its request is paid (OOC-83):
 *   the `constancia-issue` worker runs `issuePendingConstancias`.
 * - The certificate goes out in coordination's batch, on the module group of
 *   the course's last module — previewed, then confirmed by a person. The rule
 *   is the domain's (`certificateBlockReason`), run again on confirmation.
 */
export class IssuedDocumentService {
  constructor(
    private readonly documents: DocumentPreviewService,
    private readonly templates: IDocumentTemplateRepository,
    private readonly issued: DrizzleIssuedDocumentRepository,
    private readonly settings: IPlatformSettingsRepository,
    private readonly auditLog: IAuditLogRepository,
    /** The portal's origin: the validation page every document's QR points at (OOC-59). */
    private readonly portalOrigin: string,
  ) {}

  /**
   * The constancias of paid requests that have none yet. Waits — issues
   * nothing — while the constancia's template has no published version. A
   * request whose data the template cannot print is left for after the
   * template is fixed, and counted.
   */
  async issuePendingConstancias(limit = 25): Promise<{ issued: number; unprintable: number }> {
    const published = await this.templates.findPublished("enrollment_certificate");
    if (!published) return { issued: 0, unprintable: 0 };

    let issued = 0;
    let unprintable = 0;
    for (const pending of await this.issued.pendingConstancias(limit)) {
      try {
        if (await this.issueConstancia(pending, published.id, published.body)) issued += 1;
      } catch (error) {
        if (error instanceof DocumentMissingValueError) {
          unprintable += 1;
          continue;
        }
        throw error;
      }
    }
    return { issued, unprintable };
  }

  private async issueConstancia(pending: PendingConstancia, templateVersionId: string, body: string): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      const document = this.constanciaDocument(pending);
      await this.documents.assertPrintable("enrollment_certificate", body, document.data);
      try {
        return await this.issued.recordConstancia({ requestId: pending.requestId, templateVersionId, document });
      } catch (error) {
        // A code drawn twice: draw again. Anything else is not ours to retry.
        if (uniqueViolationOf(error) !== "issued_documents_code_uidx" || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  private constanciaDocument(pending: PendingConstancia): DocumentToRecord {
    const id = randomUUID();
    const code = newDocumentCode();
    const data: EnrollmentCertificateData = {
      student: issuedStudent(pending),
      course: issuedCourse(pending.course),
      classGroup: {
        code: pending.classGroup.code,
        module: pending.classGroup.module,
        schedule: scheduleTextFromSlots(pending.classGroup.slots),
        startsOn: limaDay(pending.classGroup.startsOn) ?? "",
        endsOn: limaDay(pending.classGroup.endsOn) ?? "",
      },
      period: { name: pending.periodName },
      document: { code },
      org: org(),
      issuedOn: todayInLima(),
    };
    return {
      id,
      code,
      studentId: pending.studentId,
      enrollmentId: pending.enrollmentId,
      data,
      emails: issuedDocumentEmails(
        {
          documentId: id,
          kind: "enrollment_certificate",
          code,
          student: pending,
          guardian: pending.guardian,
          courseName: pending.course.name,
        },
        "es-PE",
      ),
    };
  }

  /** Who the batch would issue for and who stays out, with the reason. Writes nothing. */
  async previewCertificates(params: { classGroupId: string; moduleId: string }): Promise<CertificatePreview> {
    const run = await this.runOf(params);
    const [settings, published] = await Promise.all([this.settings.get(), this.templates.findPublished("certificate")]);
    const closes = closesTheCourse(run, run.course.modules);
    const seats = closes ? await this.issued.certificateSeats(run) : [];
    return {
      closesTheCourse: closes,
      examRequired: run.course.examRequired,
      templatePublished: published !== null,
      items: seats.map((seat) => ({
        enrollmentId: seat.enrollmentId,
        studentId: seat.studentId,
        studentName: `${seat.firstName} ${seat.lastName}`,
        lastModuleGrade: seat.lastModuleGrade,
        blockReason: certificateBlockReason(
          {
            enrollmentId: seat.enrollmentId,
            lastModuleGrade: seat.lastModuleGrade,
            lastModuleGradeOfficial: seat.lastModuleGradeOfficial,
            earlierModuleGrades: seat.earlierModuleGrades,
            alreadyIssued: seat.issued !== null,
          },
          { passingGrade: settings.passingGrade, examRequired: run.course.examRequired, examApproved: false },
        ),
        issued: seat.issued,
      })),
    };
  }

  /**
   * The batch, confirmed by a person: issues for the enrollments sent that
   * still qualify now — the rule runs again here, never trusting the screen
   * (CLAUDE.md §8). `examApprovedEnrollmentIds` is coordination marking the
   * certification exam passed (Inglés Básico), recorded in the batch's audit
   * entry. Nothing qualifying is a refusal, not an empty success.
   */
  async issueCertificates(params: {
    actorId: string;
    classGroupId: string;
    moduleId: string;
    enrollmentIds: string[];
    examApprovedEnrollmentIds: string[];
  }): Promise<{ issued: number; skipped: number }> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.issueCertificatesOnce(params);
      } catch (error) {
        // A code drawn twice, or a certificate issued meanwhile by somebody
        // else: read again — the second one is now `already_issued`.
        if (uniqueViolationOf(error) === null || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  private async issueCertificatesOnce(params: {
    actorId: string;
    classGroupId: string;
    moduleId: string;
    enrollmentIds: string[];
    examApprovedEnrollmentIds: string[];
  }): Promise<{ issued: number; skipped: number }> {
    const run = await this.runOf(params);
    if (!closesTheCourse(run, run.course.modules)) throw new CertificateRunNotLastModuleError();
    const published = await this.templates.findPublished("certificate");
    if (!published) throw new DocumentTemplateNotPublishedError();
    const settings = await this.settings.get();

    const asked = new Set(params.enrollmentIds);
    const examApproved = new Set(params.examApprovedEnrollmentIds);
    const seats = (await this.issued.certificateSeats(run)).filter((seat) => asked.has(seat.enrollmentId));
    const qualifying = seats.filter(
      (seat) =>
        certificateBlockReason(
          {
            enrollmentId: seat.enrollmentId,
            lastModuleGrade: seat.lastModuleGrade,
            lastModuleGradeOfficial: seat.lastModuleGradeOfficial,
            earlierModuleGrades: seat.earlierModuleGrades,
            alreadyIssued: seat.issued !== null,
          },
          {
            passingGrade: settings.passingGrade,
            examRequired: run.course.examRequired,
            examApproved: examApproved.has(seat.enrollmentId),
          },
        ) === null,
    );
    if (qualifying.length === 0) throw new CertificateNothingToIssueError();

    const documents = qualifying.map((seat) => this.certificateDocument(seat, run));
    // Every document must print before any is recorded: a value the template
    // lacks refuses the batch instead of recording documents nobody can open.
    for (const document of documents) {
      await this.documents.assertPrintable("certificate", published.body, document.data);
    }

    await this.issued.recordCertificates({
      actorId: params.actorId,
      classGroupId: run.classGroup.id,
      runId: run.id,
      templateVersionId: published.id,
      documents,
      // Only the marks that mattered: an exam marked on somebody who was out
      // for another reason issued nothing.
      examApprovedEnrollmentIds: run.course.examRequired
        ? qualifying.map((seat) => seat.enrollmentId).filter((id) => examApproved.has(id))
        : [],
    });
    return { issued: documents.length, skipped: params.enrollmentIds.length - documents.length };
  }

  private certificateDocument(seat: CertificateSeat, run: CertificateRun): DocumentToRecord {
    const id = randomUUID();
    const code = newDocumentCode();
    // Only a passing, non-DA grade reaches here (the rule).
    const score = seat.lastModuleGrade?.score ?? 0;
    const data: CertificateData = {
      student: issuedStudent(seat),
      course: issuedCourse(run.course),
      classGroup: {
        code: run.classGroup.code,
        startsOn: limaDay(run.classGroup.startsOn) ?? "",
        endsOn: limaDay(run.classGroup.endsOn) ?? "",
      },
      // As typed: 16.5 prints "16.5", 14 prints "14".
      finalGrade: String(Number(score)),
      document: { code },
      org: org(),
      issuedOn: todayInLima(),
    };
    return {
      id,
      code,
      studentId: seat.studentId,
      enrollmentId: seat.enrollmentId,
      data,
      // Issued again after a revocation (OOC-59): the new one points at the old.
      replacesId: seat.revokedId,
      emails: issuedDocumentEmails(
        { documentId: id, kind: "certificate", code, student: seat, guardian: seat.guardian, courseName: run.course.name },
        "es-PE",
      ),
    };
  }

  /** The module group of this class group, live — or the same 404 as a class group that is not there. */
  private async runOf(params: { classGroupId: string; moduleId: string }): Promise<CertificateRun> {
    const run = await this.issued.certificateRun(params.classGroupId, params.moduleId);
    if (!run || run.retired || run.classGroup.retired) throw new CatalogClassGroupNotFoundError();
    return run;
  }

  /**
   * The PDF of an issued document, printed from its template version and its
   * frozen data, with its code in the frame. Staff reach any document; a
   * portal account only one about a file it reaches — anything else is the
   * same 404. Every print is audited. A portal account prints only a document
   * that still holds (OOC-59): a revoked or replaced one is the record's, not
   * a paper to hand out again — staff still print it.
   */
  async download(params: { actorId: string; documentId: string; portalAccount: boolean }): Promise<IssuedPdf> {
    const document = params.portalAccount
      ? await this.issued.findForAccount(params.actorId, params.documentId)
      : await this.issued.findById(params.documentId);
    if (!document) throw new IssuedDocumentNotFoundError();
    if (params.portalAccount && (await this.issued.statusOf(document.id)) !== "valid") {
      throw new IssuedDocumentNotFoundError();
    }
    return this.print(document, params.actorId);
  }

  /**
   * Revokes a document (OOC-59 — proposal, to confirm with the owner): a
   * person, with a reason. From then on the validation page answers "revoked"
   * for its code. Not undone: a certificate is issued again by the batch, and
   * the new one replaces this one.
   */
  async revoke(params: { actorId: string; documentId: string; reason: string }): Promise<{ revocationId: string }> {
    const reason = params.reason.trim();
    if (reason.length === 0 || reason.length > REVOCATION_REASON_MAX_LENGTH) {
      throw new IssuedDocumentRevocationReasonRequiredError();
    }
    const document = await this.issued.findById(params.documentId);
    if (!document) throw new IssuedDocumentNotFoundError();
    if ((await this.issued.statusOf(document.id)) !== "valid") throw new IssuedDocumentAlreadyRevokedError();
    return this.issued.revoke({ actorId: params.actorId, document, reason });
  }

  /**
   * The public validation page's answer for a typed code (OOC-59): the public
   * fields alone. A code that cannot be one and a code nobody issued are the
   * same 404 — the page never says which.
   */
  async verify(rawCode: string): Promise<PublicIssuedDocument> {
    const code = normalizeDocumentCode(rawCode);
    const found = code ? await this.issued.findPublicByCode(code) : null;
    if (!found) throw new IssuedDocumentNotFoundError();
    return found;
  }

  private async print(document: IssuedDocument, actorId: string): Promise<IssuedPdf> {
    const version = await this.templates.findVersion(document.kind, document.templateVersionId);
    if (!version) throw new IssuedDocumentNotFoundError();
    const url = verificationUrl(this.portalOrigin, document.code);
    const pdf = await this.documents.renderPdf(document.kind, version.body, document.data, {
      verificationCode: document.code,
      verification: { url, qrDataUri: await verificationQrDataUri(url) },
    });
    await this.auditLog.append({
      actorId,
      action: "issued_document.downloaded",
      targetId: document.id,
      metadata: { kind: document.kind, studentId: document.studentId, enrollmentId: document.enrollmentId },
      at: new Date(),
    });
    return { pdf, code: document.code };
  }
}
