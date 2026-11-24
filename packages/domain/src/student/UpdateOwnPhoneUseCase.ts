import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import type { IPortalProfileFileRepository } from "./PortalProfileFileRepository.js";
import type { IStudentRepository } from "./StudentRepository.js";

export interface UpdateOwnPhoneInput {
  /** The signed-in portal account — from the session, never the client. */
  userId: string;
  /** A profile of that account (any file id of the person). */
  profileId: string;
  phone: string;
}

/**
 * The portal account corrects the phone of the profile it is looking at
 * (OOC-110): the student their own, the guardian a child's (the guardian
 * sees everything the profile sees, OOC-147). Phone only — the e-mail is the
 * Classroom account and the portal login, and name, document and birth date
 * stay a staff correction (OOC-74).
 *
 * The audit line names the field, never the number (CLAUDE.md §8).
 */
export class UpdateOwnPhoneUseCase extends BaseUseCase<UpdateOwnPhoneInput, { phone: string }> {
  constructor(
    private readonly profiles: IPortalProfileFileRepository,
    private readonly students: IStudentRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateOwnPhoneInput): Promise<{ phone: string }> {
    const fileId = await this.profiles.findProfileFileId(input.userId, input.profileId);
    const student = fileId ? await this.students.findById(fileId) : null;
    // Someone else's file answers like one that does not exist (CLAUDE.md §8).
    if (!student) {
      throw new NotFoundError({ reason: "portal_profile.not_found", message: "No such profile on this account." });
    }

    if (!student.changePhone(input.phone)) return { phone: student.phone };

    const saved = await this.students.update(student);
    await this.auditLog.append({
      actorId: input.userId,
      action: "student.phone_self_updated",
      targetId: student.id,
      metadata: { fields: ["phone"] },
      at: saved.updatedAt,
    });
    return { phone: saved.phone };
  }
}
