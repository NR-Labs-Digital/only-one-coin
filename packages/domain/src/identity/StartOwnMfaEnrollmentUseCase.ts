import type { Locale } from "../notification/EmailNotification.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { MfaAlreadyEnabledError } from "./errors.js";
import type { IStaffSecondFactor } from "./ports/IStaffSecondFactor.js";

export interface StartOwnMfaEnrollmentInput {
  /** Always the session's own user — never an id from the request body. */
  userId: string;
  /** The session the code is bound to; the same one has to confirm it. */
  sessionToken: string;
  locale: Locale;
}

/**
 * First half of turning on the second factor (OOC-29): e-mail a code to the
 * account's own address. Asking again replaces the code — the last one sent
 * is the one that works. Throttled by the route's rate limit, not here.
 */
export class StartOwnMfaEnrollmentUseCase extends BaseUseCase<StartOwnMfaEnrollmentInput, void> {
  constructor(private readonly secondFactor: IStaffSecondFactor) {
    super();
  }

  async run(input: StartOwnMfaEnrollmentInput): Promise<void> {
    const state = await this.secondFactor.state(input.userId);
    if (state.enabled) {
      throw new MfaAlreadyEnabledError();
    }

    await this.secondFactor.sendEnrollmentCode(input.sessionToken, input.locale);
  }
}
