import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CurrentPasswordIncorrectError, MfaNotEnabledError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IFreshAuthVerifier } from "./ports/IFreshAuthVerifier.js";
import type { IStaffSecondFactor } from "./ports/IStaffSecondFactor.js";

export interface RegenerateOwnRecoveryCodesInput {
  /** Always the session's own user — never an id from the request body. */
  userId: string;
  password: string;
}

export interface RegenerateOwnRecoveryCodesOutput {
  recoveryCodes: string[];
}

/**
 * Issues a new set of recovery codes and voids the old one (OOC-29) — after
 * using most of them, or when the printed sheet went missing. Asks for the
 * password again even with the session open: a set of recovery codes is a way
 * past the e-mail code, and an unattended screen should not be enough to mint one.
 */
export class RegenerateOwnRecoveryCodesUseCase extends BaseUseCase<
  RegenerateOwnRecoveryCodesInput,
  RegenerateOwnRecoveryCodesOutput
> {
  constructor(
    private readonly freshAuthVerifier: IFreshAuthVerifier,
    private readonly secondFactor: IStaffSecondFactor,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RegenerateOwnRecoveryCodesInput): Promise<RegenerateOwnRecoveryCodesOutput> {
    const isCurrentPassword = await this.freshAuthVerifier.verify(input.userId, input.password);
    if (!isCurrentPassword) {
      throw new CurrentPasswordIncorrectError();
    }

    const state = await this.secondFactor.state(input.userId);
    if (!state.enabled) {
      throw new MfaNotEnabledError();
    }

    const recoveryCodes = await this.secondFactor.replaceRecoveryCodes(input.userId);

    await this.auditLogRepository.append({
      actorId: input.userId,
      action: "staff.mfa_recovery_codes_regenerated",
      targetId: input.userId,
      metadata: { codesLeftBefore: state.recoveryCodesLeft },
      at: new Date(),
    });

    return { recoveryCodes };
  }
}
