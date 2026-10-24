import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherContractNotFoundError } from "./errors.js";
import type { ITeacherContractRepository } from "./TeacherContractRepository.js";
import type { ITeacherContractStorage } from "./TeacherContractStorage.js";

/** How long a download link lives — the same five minutes as a receipt (CLAUDE.md §8). */
export const TEACHER_CONTRACT_URL_TTL_SECONDS = 5 * 60;

/**
 * A five-minute link to a contract filed as a PDF (OOC-81). A contract
 * carries the teacher's document and terms, so every opening goes to the
 * audit log, the same as a receipt. A contract generated from the template
 * (OOC-124) has no file to open — it prints again from its template version —
 * so it answers as not found here.
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
    if (!contract?.file) throw new TeacherContractNotFoundError();

    const url = await this.storage.createDownloadUrl({
      objectKey: contract.file.objectKey,
      fileName: contract.file.fileName,
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
