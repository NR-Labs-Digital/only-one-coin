import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffTrustedBrowsers } from "./ports/IStaffTrustedBrowsers.js";

export interface ForgetOwnTrustedBrowsersInput {
  /** Always the session's own user — never an id from the request body. */
  userId: string;
}

/**
 * "Forget the remembered browsers" on the account screen (OOC-154): the next
 * sign-in from any of them asks for the e-mailed code again. Every cargo may
 * do it — whoever can be remembered can be forgotten. Logged even when there
 * was nothing to forget: the person asked, and the log says so.
 */
export class ForgetOwnTrustedBrowsersUseCase extends BaseUseCase<ForgetOwnTrustedBrowsersInput, { forgotten: number }> {
  constructor(
    private readonly trustedBrowsers: IStaffTrustedBrowsers,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: ForgetOwnTrustedBrowsersInput): Promise<{ forgotten: number }> {
    const forgotten = await this.trustedBrowsers.forgetAll(input.userId);

    await this.auditLogRepository.append({
      actorId: input.userId,
      action: "staff.trusted_browsers_forgotten",
      targetId: input.userId,
      metadata: { forgotten },
      at: new Date(),
    });

    return { forgotten };
  }
}
