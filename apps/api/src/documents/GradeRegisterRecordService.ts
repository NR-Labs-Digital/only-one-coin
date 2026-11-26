import {
  DocumentTemplateNotPublishedError,
  NotFoundError,
  UnableToProcessEntryError,
  ownTeacherId,
  type IAuditLogRepository,
  type IDocumentTemplateRepository,
  type IPlatformSettingsRepository,
  type ITeacherRepository,
} from "@ooc/domain";
import type {
  DrizzleGradeRegisterRecordRepository,
  GradeRegisterRecordFilters,
  GradeRegisterRecordRow,
} from "@/infra/persistence/teaching/DrizzleGradeRegisterRecordRepository.js";
import type { DocumentPreviewService } from "./DocumentPreviewService.js";
import copy from "./locales/es-PE.json" with { type: "json" };
import { issuedCourse, limaDay, org } from "./kinds/issuedDocumentData.js";
import {
  GradeRegisterRecordFrozenSchema,
  moduleLabel,
  type GradeRegisterRecordFrozen,
  type GradeRegisterRecordLive,
} from "./kinds/gradeRegisterRecord.js";

const KIND = "grade_register_record";

/** Not an official register, erased, or another teacher's — the same 404 (anti-IDOR). */
export class GradeRegisterRecordNotFoundError extends NotFoundError {
  constructor() {
    super({ reason: "grade_register_record.not_found", message: "No acta for this grade register." });
  }
}

/** The run has no teacher from the roster to put on the acta. */
export class GradeRegisterRecordNoTeacherError extends UnableToProcessEntryError {
  constructor() {
    super({
      reason: "grade_register_record.no_teacher",
      message: "The module group has no teacher from the roster; assign one before downloading the acta.",
    });
  }
}

export interface GradeRegisterRecordListItem extends GradeRegisterRecordRow {
  failed: number;
}

export interface GradeRegisterRecordPdf {
  pdf: Uint8Array;
  fileName: string;
}

/**
 * The teacher's acta de notas (OOC-176): the PDF of an official grade
 * register, what the teacher is paid against. Same pattern as the issued
 * documents (OOC-33) — printed on every download, never stored — with two
 * differences:
 *
 * - **Recorded on the first download**, not on confirmation: confirming never
 *   waits on a template, and registers confirmed before this existed get an
 *   acta too. The record freezes the teacher, the class group, who confirmed
 *   and the template version; renders first, records after, so an acta the
 *   template cannot print is never recorded.
 * - **The counts are live** (decision of 26/11/2026 with Miguel, to confirm
 *   with the client): a grade corrected after official changes the next
 *   download, which says "corregida el …".
 *
 * No verification code: the acta is an internal document between the
 * institution and its teacher, not one handed to the public.
 */
export class GradeRegisterRecordService {
  constructor(
    private readonly documents: DocumentPreviewService,
    private readonly templates: IDocumentTemplateRepository,
    private readonly records: DrizzleGradeRegisterRecordRepository,
    private readonly teachers: ITeacherRepository,
    private readonly settings: IPlatformSettingsRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {}

  /** The panel's list: every official register, filtered. */
  async list(filters: GradeRegisterRecordFilters): Promise<GradeRegisterRecordListItem[]> {
    const { passingGrade } = await this.settings.get();
    return (await this.records.list(filters, passingGrade)).map(withFailed);
  }

  /**
   * The signed-in teacher's own actas. The teacher comes from the session's
   * account; an account linked to no file owns nothing (CLAUDE.md §8).
   */
  async listOwn(userId: string): Promise<GradeRegisterRecordListItem[]> {
    const teacherId = await ownTeacherId(this.teachers, userId);
    if (teacherId === null) return [];
    const { passingGrade } = await this.settings.get();
    const rows = await this.records.list({ academicPeriodId: null, teacherId }, passingGrade);
    // Checked again here, not only in the SQL: the scope is the use case's.
    return rows.filter((row) => row.teacherId !== null && row.teacherId === teacherId).map(withFailed);
  }

  /**
   * The acta's PDF. `teacherUserId` scopes it to the teacher portal: the
   * acta of a register of somebody else's run is the same 404 as one that
   * does not exist. Every download is audited.
   */
  async download(params: { actorId: string; registerId: string; teacherUserId?: string }): Promise<GradeRegisterRecordPdf> {
    const { passingGrade } = await this.settings.get();
    let row = await this.records.findOfficial(params.registerId, passingGrade);
    if (!row) throw new GradeRegisterRecordNotFoundError();
    if (params.teacherUserId !== undefined) {
      const teacherId = await ownTeacherId(this.teachers, params.teacherUserId);
      if (teacherId === null || row.teacherId === null || row.teacherId !== teacherId) {
        throw new GradeRegisterRecordNotFoundError();
      }
    }

    const now = new Date();
    let firstDownload = false;
    if (!row.record) {
      const published = await this.templates.findPublished(KIND);
      if (!published) throw new DocumentTemplateNotPublishedError();
      const frozen = await this.freeze(row);
      // The template must print this acta before anything is recorded.
      await this.documents.assertPrintable(KIND, published.body, { ...frozen, ...liveOf(row, passingGrade, now) });
      await this.records.record({
        registerId: row.registerId,
        teacherId: row.teacherId!,
        templateVersionId: published.id,
        data: frozen,
        recordedBy: params.actorId,
      });
      firstDownload = true;
      // Another download may have recorded it first: print the one that holds.
      row = await this.records.findOfficial(params.registerId, passingGrade);
      if (!row?.record) throw new GradeRegisterRecordNotFoundError();
    }

    const record = row.record!;
    const version = await this.templates.findVersion(KIND, record.templateVersionId);
    if (!version) throw new GradeRegisterRecordNotFoundError();
    const frozen = GradeRegisterRecordFrozenSchema.parse(record.data);
    const pdf = await this.documents.renderPdf(KIND, version.body, { ...frozen, ...liveOf(row, passingGrade, now) });

    await this.auditLog.append({
      actorId: params.actorId,
      action: "grade_register_record.downloaded",
      targetId: row.registerId,
      metadata: {
        classGroupId: row.classGroupId,
        classGroupModuleId: row.classGroupModuleId,
        recordId: record.id,
        templateVersionId: record.templateVersionId,
        firstDownload,
      },
      at: now,
    });
    return { pdf, fileName: fileNameOf(row) };
  }

  private async freeze(row: GradeRegisterRecordRow): Promise<GradeRegisterRecordFrozen> {
    if (row.teacherId === null) throw new GradeRegisterRecordNoTeacherError();
    const teacher = await this.records.findTeacher(row.teacherId);
    if (!teacher) throw new GradeRegisterRecordNoTeacherError();
    const documentTypes: Record<string, string> = copy.nationalIdTypes;
    return {
      teacher: {
        fullName: `${teacher.firstName} ${teacher.lastName}`,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        documentType: teacher.nationalIdType ? (documentTypes[teacher.nationalIdType] ?? teacher.nationalIdType) : null,
        nationalId: teacher.nationalId,
      },
      classGroup: {
        code: row.classGroupCode,
        startsOn: row.classGroupStartsOn ?? "",
        endsOn: row.classGroupEndsOn ?? "",
      },
      course: issuedCourse({
        name: row.courseName,
        language: row.courseLanguage,
        level: row.courseLevel,
        totalHours: row.courseTotalHours,
      }),
      period: { name: row.academicPeriodName },
      module: { number: row.module, label: moduleLabel(row.module), round: row.round },
      confirmed: { byName: row.confirmedByName ?? "", on: limaDay(row.confirmedAt)! },
      org: org(),
    };
  }
}

function withFailed(row: GradeRegisterRecordRow): GradeRegisterRecordListItem {
  return { ...row, failed: Math.max(0, row.students - row.passed - row.didNotSit) };
}

function liveOf(row: GradeRegisterRecordRow, passingGrade: number, now: Date): GradeRegisterRecordLive {
  return {
    counts: {
      students: row.students,
      passed: row.passed,
      failed: Math.max(0, row.students - row.passed - row.didNotSit),
      didNotSit: row.didNotSit,
    },
    passingGrade: String(passingGrade),
    correctedOn: limaDay(row.correctedAt),
    issuedOn: limaDay(now)!,
  };
}

/** `acta-A-00042-m2.pdf` — ASCII on purpose: it goes in a header. */
function fileNameOf(row: GradeRegisterRecordRow): string {
  const module = row.module === null ? "" : `-m${row.module}`;
  const round = row.round > 1 ? `-r${row.round}` : "";
  return `acta-${row.classGroupCode}${module}${round}.pdf`.replace(/[^A-Za-z0-9._-]/g, "");
}
