import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CurrentPasswordIncorrectError, MfaNotEnabledError, MfaRequiredForRoleError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IFreshAuthVerifier } from "./ports/IFreshAuthVerifier.js";
import type { IStaffSecondFactor } from "./ports/IStaffSecondFactor.js";
import { requiresMfa, type Role } from "./Role.js";

export interface DisableOwnMfaInput {
  /** Always the session's own user — never an id from the request body. */
  userId: string;
  /** The session's own cargo, read from the database by the authorization hook. */
  role: Role;
  password: string;
}

/**
 * Turns the second factor off (OOC-29) — only for a cargo where it is
 * optional. `master`, `admin` and `billing` are refused whatever they send
 * (CLAUDE.md §8): there is no switch for them, here or in Better Auth's own
 * `/two-factor/disable`, which the auth catch-all does not let through.
 */
export class DisableOwnMfaUseCase extends BaseUseCase<DisableOwnMfaInput, void> {
  constructor(
    private readonly freshAuthVerifier: IFreshAuthVerifier,
    private readonly secondFactor: IStaffSecondFactor,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: DisableOwnMfaInput): Promise<void> {
    if (requiresMfa(input.role)) {
      throw new MfaRequiredForRoleError();
    }

    const isCurrentPassword = await this.freshAuthVerifier.verify(input.userId, input.password);
    if (!isCurrentPassword) {
      throw new CurrentPasswordIncorrectError();
    }

    const state = await this.secondFactor.state(input.userId);
    if (!state.enabled) {
      throw new MfaNotEnabledError();
    }

    await this.secondFactor.disable(input.userId);

    await this.auditLogRepository.append({
      actorId: input.userId,
      action: "staff.mfa_disabled",
      targetId: input.userId,
      metadata: {},
      at: new Date(),
    });
  }
}
