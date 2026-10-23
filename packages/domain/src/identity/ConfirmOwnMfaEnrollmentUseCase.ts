import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { MfaAlreadyEnabledError, MfaCodeRejectedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffSecondFactor } from "./ports/IStaffSecondFactor.js";

export interface ConfirmOwnMfaEnrollmentInput {
  /** Always the session's own user — never an id from the request body. */
  userId: string;
  sessionToken: string;
  code: string;
}

export interface ConfirmOwnMfaEnrollmentOutput {
  /** Shown once, right now — the platform keeps them encrypted and never shows them again. */
  recoveryCodes: string[];
  /** See `ConfirmMfaEnrollmentResult` — the replaced session's cookies. */
  sessionCookies: string[];
}

/**
 * Second half of turning on the second factor (OOC-29). The code proves the
 * person reads the account's inbox; from then on every sign-in asks for a
 * code too. The recovery codes are issued in the same call so nobody leaves
 * the enrollment without them.
 *
 * Not atomic across the two steps: the factor lives in Better Auth's tables
 * and is switched on by its own verification. If issuing the recovery codes
 * then fails, the account is protected but has none — the account screen
 * shows zero left and offers to issue them, which is the safe side.
 */
export class ConfirmOwnMfaEnrollmentUseCase extends BaseUseCase<
  ConfirmOwnMfaEnrollmentInput,
  ConfirmOwnMfaEnrollmentOutput
> {
  constructor(
    private readonly secondFactor: IStaffSecondFactor,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: ConfirmOwnMfaEnrollmentInput): Promise<ConfirmOwnMfaEnrollmentOutput> {
    const state = await this.secondFactor.state(input.userId);
    if (state.enabled) {
      throw new MfaAlreadyEnabledError();
    }

    const result = await this.secondFactor.confirmEnrollment(input.sessionToken, input.code);
    if (!result.ok) {
      throw new MfaCodeRejectedError({ reason: result.reason });
    }

    const recoveryCodes = await this.secondFactor.replaceRecoveryCodes(input.userId);

    await this.auditLogRepository.append({
      actorId: input.userId,
      action: "staff.mfa_enabled",
      targetId: input.userId,
      metadata: { method: "email" },
      at: new Date(),
    });

    return { recoveryCodes, sessionCookies: result.sessionCookies };
  }
}
