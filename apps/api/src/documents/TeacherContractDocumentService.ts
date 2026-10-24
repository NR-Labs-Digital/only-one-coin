import {
  DocumentTemplateNotPublishedError,
  TeacherNotFoundError,
  UnableToProcessEntryError,
  type IAuditLogRepository,
  type IDocumentTemplateRepository,
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
  /** The published version the text came from. */
  templateVersion: number;
}

/**
 * The teacher contract, filled and ready to print (OOC-123): the published
 * version of the template, the teacher's file and the period chosen at the
 * moment. Built on demand and never stored — the same inputs build the same
 * document again, and the signed copy is kept outside the platform (decision
 * of 23/10/2026; recording the period is OOC-124).
 *
 * Only the published version issues documents: a draft is work in progress,
 * and printing one would put text nobody approved in front of a teacher.
 */
export class TeacherContractDocumentService {
  constructor(
    private readonly documents: DocumentPreviewService,
    private readonly templates: IDocumentTemplateRepository,
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {}

  async generate(input: GenerateTeacherContractInput): Promise<GeneratedTeacherContract> {
    // Calendar days compare as text: `YYYY-MM-DD` sorts in date order.
    if (input.endsOn <= input.startsOn) throw new ContractPeriodOutOfOrderError();

    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const published = await this.templates.findPublished("teacher_contract");
    if (!published) throw new DocumentTemplateNotPublishedError();

    const pdf = await this.documents.renderPdf(
      "teacher_contract",
      published.body,
      teacherContractData(teacher, { startsOn: input.startsOn, endsOn: input.endsOn }),
    );

    // Who printed which teacher's contract, from which text. Ids only (CLAUDE.md §8).
    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher_contract.generated",
      targetId: teacher.id,
      metadata: { templateVersionId: published.id, templateVersion: published.version },
      at: new Date(),
    });

    return { pdf, templateVersion: published.version };
  }
}
