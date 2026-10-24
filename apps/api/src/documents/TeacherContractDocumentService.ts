import {
  DocumentTemplateNotPublishedError,
  TeacherContract,
  TeacherContractNotFoundError,
  TeacherNotFoundError,
  UnableToProcessEntryError,
  type IAuditLogRepository,
  type IDocumentTemplateRepository,
  type ITeacherContractRepository,
  type ITeacherRepository,
} from "@ooc/domain";
import type { DocumentPreviewService } from "./DocumentPreviewService.js";
import { teacherContractData } from "./kinds/teacherContract.js";

/** The contract would end on or before the day it starts. */
export class ContractPeriodOutOfOrderError extends UnableToProcessEntryError {
  constructor() {
    super({ reason: "teacher_contract.period_out_of_order", message: "A contract must end after it starts." });
  }
}

export interface GenerateTeacherContractInput {
  actorId: string;
  teacherId: string;
  /** Calendar days, `YYYY-MM-DD`. */
  startsOn: string;
  endsOn: string;
}

export interface GeneratedTeacherContract {
  pdf: Uint8Array;
  /** The contract row recorded for this period. */
  contractId: string;
  /** The published version the text came from. */
  templateVersion: number;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The teacher contract, filled and ready to print (OOC-123): the published
 * version of the template, the teacher's file and the period chosen at the
 * moment. Generating it records the contract (OOC-124) — the period, who
 * generated it and the template version — and that period is what the
 * roster's alert watches. The PDF itself is never stored: it prints again
 * from the recorded version, and the signed copy is kept outside the platform
 * (decision of 23/10/2026).
 *
 * Only the published version issues documents: a draft is work in progress,
 * and printing one would put text nobody approved in front of a teacher.
 */
export class TeacherContractDocumentService {
  constructor(
    private readonly documents: DocumentPreviewService,
    private readonly templates: IDocumentTemplateRepository,
    private readonly teachers: ITeacherRepository,
    private readonly contracts: ITeacherContractRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {}

  async generate(input: GenerateTeacherContractInput): Promise<GeneratedTeacherContract> {
    // Calendar days compare as text: `YYYY-MM-DD` sorts in date order.
    if (input.endsOn <= input.startsOn) throw new ContractPeriodOutOfOrderError();

    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const published = await this.templates.findPublished("teacher_contract");
    if (!published) throw new DocumentTemplateNotPublishedError();

    // Rendered before anything is written: a template that cannot print this
    // file (a value it lacks) records no contract.
    const pdf = await this.documents.renderPdf(
      "teacher_contract",
      published.body,
      teacherContractData(teacher, { startsOn: input.startsOn, endsOn: input.endsOn }),
    );

    const contract = await this.contracts.create(
      TeacherContract.record({
        teacherId: teacher.id,
        templateVersionId: published.id,
        recordedBy: input.actorId,
        period: { startsOn: input.startsOn, endsOn: input.endsOn },
      }),
    );

    // Who printed which teacher's contract, from which text. Ids only (CLAUDE.md §8).
    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher_contract.generated",
      targetId: teacher.id,
      metadata: { contractId: contract.id, templateVersionId: published.id, templateVersion: published.version },
      at: contract.createdAt,
    });

    return { pdf, contractId: contract.id, templateVersion: published.version };
  }

  /**
   * A recorded contract printed again: the version it was generated from and
   * the period recorded with it. The teacher's data is today's — a corrected
   * name prints corrected. A contract filed as a PDF (OOC-81) has no version
   * and opens by its file instead, so it answers as not found here.
   */
  async regenerate(input: {
    actorId: string;
    teacherId: string;
    contractId: string;
  }): Promise<{ pdf: Uint8Array; templateVersion: number }> {
    const contract = await this.contracts.findForTeacher(input.teacherId, input.contractId);
    if (!contract?.templateVersionId) throw new TeacherContractNotFoundError();

    const teacher = await this.teachers.findById(contract.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const version = await this.templates.findVersion("teacher_contract", contract.templateVersionId);
    if (!version) throw new TeacherContractNotFoundError();

    const pdf = await this.documents.renderPdf(
      "teacher_contract",
      version.body,
      teacherContractData(teacher, { startsOn: day(contract.startsOn), endsOn: day(contract.endsOn) }),
    );

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher_contract.regenerated",
      targetId: teacher.id,
      metadata: { contractId: contract.id, templateVersionId: version.id, templateVersion: version.version },
      at: new Date(),
    });

    return { pdf, templateVersion: version.version };
  }
}
