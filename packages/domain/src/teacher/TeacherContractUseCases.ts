// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import {
  TeacherContractInvalidFileError,
  TeacherContractNotFoundError,
  TeacherContractUploadMissingError,
  TeacherNotFoundError,
} from "./errors.js";
import type { IPdfInspector } from "./PdfInspector.js";
import {
  looksLikePdf,
  TEACHER_CONTRACT_CONTENT_TYPE,
  TEACHER_CONTRACT_MAX_BYTES,
  TeacherContract,
  teacherContractObjectKey,
  type FileTeacherContractDTO,
} from "./TeacherContract.js";
import type { ITeacherContractRepository } from "./TeacherContractRepository.js";
import type { ITeacherContractStorage, PresignedContractUpload } from "./TeacherContractStorage.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

/** How long a download link lives — the same five minutes as a receipt (CLAUDE.md §8). */
export const TEACHER_CONTRACT_URL_TTL_SECONDS = 5 * 60;

export interface RequestTeacherContractUploadOutput {
  contractUploadId: string;
  upload: PresignedContractUpload;
  maxBytes: number;
}

/**
 * Mints the target the panel sends a signed contract to (OOC-81). The bytes go
 * straight to the bucket; nothing is written until the contract is filed, so an
 * upload abandoned here leaves no row behind.
 */
export class RequestTeacherContractUploadUseCase extends BaseUseCase<
  { teacherId: string },
  RequestTeacherContractUploadOutput
> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly storage: ITeacherContractStorage,
  ) {
    super();
  }

  async run(input: { teacherId: string }): Promise<RequestTeacherContractUploadOutput> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const contractUploadId = uuid();
    const upload = await this.storage.createUploadTarget({
      objectKey: teacherContractObjectKey(teacher.id, contractUploadId),
      contentType: TEACHER_CONTRACT_CONTENT_TYPE,
      maxBytes: TEACHER_CONTRACT_MAX_BYTES,
    });

    return { contractUploadId, upload, maxBytes: TEACHER_CONTRACT_MAX_BYTES };
  }
}

export interface FileTeacherContractInput {
  actorId: string;
  teacherId: string;
  contractUploadId: string;
  contract: FileTeacherContractDTO;
}

/**
 * Files a signed contract on a teacher (OOC-81): file, start and end together
 * or nothing (CLAUDE.md §1). Filing again is a new row — the history stays, and
 * the newest is the one in force. A teacher off the roster can still have one
 * filed: the paperwork for coming back is done before coming back.
 *
 * The object key is rebuilt from the teacher in the URL and the upload id, so a
 * filing can only claim an object uploaded for this teacher. The file is
 * opened here, not in a worker: filing a contract is a rare staff action, the
 * size is checked before a byte is read, and the PDF is kept as it came, with
 * no re-encode to queue. It must open as a PDF with at least one page — five
 * magic bytes alone let a truncated or empty file through. A refused file is
 * removed from the bucket.
 */
export class FileTeacherContractUseCase extends BaseUseCase<FileTeacherContractInput, TeacherContract> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly contracts: ITeacherContractRepository,
    private readonly storage: ITeacherContractStorage,
    private readonly pdf: IPdfInspector,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: FileTeacherContractInput): Promise<TeacherContract> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const objectKey = teacherContractObjectKey(teacher.id, input.contractUploadId);
    const byteSize = await this.storage.size(objectKey);
    if (byteSize === null) throw new TeacherContractUploadMissingError();

    if (byteSize <= 0 || byteSize > TEACHER_CONTRACT_MAX_BYTES || !(await this.opensAsPdf(objectKey))) {
      await this.storage.delete(objectKey);
      throw new TeacherContractInvalidFileError();
    }

    // The form is checked before anything is written; a bad date leaves the
    // upload in place so the person can correct the field and file it again.
    const contract = TeacherContract.file({
      id: input.contractUploadId,
      teacherId: teacher.id,
      objectKey,
      fileSizeBytes: byteSize,
      uploadedBy: input.actorId,
      contract: input.contract,
    });

    const saved = await this.contracts.create(contract);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher.contract_filed",
      targetId: teacher.id,
      metadata: { contractId: saved.id },
      at: saved.createdAt,
    });

    return saved;
  }

  private async opensAsPdf(objectKey: string): Promise<boolean> {
    const bytes = await this.storage.read(objectKey);
    if (!looksLikePdf(bytes)) return false;
    const pages = await this.pdf.pageCount(bytes);
    return pages !== null && pages > 0;
  }
}

/**
 * A five-minute link to one filed contract (OOC-81). A contract carries the
 * teacher's document and terms, so every opening goes to the audit log, the
 * same as a receipt.
 */
export class OpenTeacherContractUseCase extends BaseUseCase<
  { actorId: string; teacherId: string; contractId: string },
  { url: string; expiresAt: Date }
> {
  constructor(
    private readonly contracts: ITeacherContractRepository,
    private readonly storage: ITeacherContractStorage,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: { actorId: string; teacherId: string; contractId: string }): Promise<{ url: string; expiresAt: Date }> {
    const contract = await this.contracts.findForTeacher(input.teacherId, input.contractId);
    if (!contract) throw new TeacherContractNotFoundError();

    const url = await this.storage.createDownloadUrl({
      objectKey: contract.objectKey,
      fileName: contract.fileName,
      expiresInSeconds: TEACHER_CONTRACT_URL_TTL_SECONDS,
    });
    const now = new Date();

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher.contract_viewed",
      targetId: contract.teacherId,
      metadata: { contractId: contract.id },
      at: now,
    });

    return { url, expiresAt: new Date(now.getTime() + TEACHER_CONTRACT_URL_TTL_SECONDS * 1000) };
  }
}
