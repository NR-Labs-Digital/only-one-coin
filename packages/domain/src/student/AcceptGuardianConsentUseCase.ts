import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import { CURRENT_CONSENT_VERSION, guardianConsentStateOf, isGuardianAccount } from "./guardianConsent.js";
import type { IGuardianConsentRepository } from "./GuardianConsentRepository.js";

export interface AcceptGuardianConsentInput {
  /** The signed-in portal account — from the session, never the client. */
  userId: string;
  /** A profile of that account (any file id of the person). */
  profileId: string;
  /** The version the screen showed; anything but the one in force is refused. */
  version: string;
  /** The guardian's IP, as the edge saw it. */
  ip: string;
}

export type AcceptGuardianConsentOutcome = "accepted" | "already_accepted";

/**
 * The guardian accepts the consent text in the portal (OOC-72) — the way a
 * file registered in the backoffice, born with consent pending, gets it.
 * The guardian is the one who accepts, with the date, the text version and
 * their IP (Ley 29733, CLAUDE.md §8): only the account whose e-mail is the
 * live guardian's may, and only for a minor. Staff never writes it.
 *
 * Accepting twice (a double click, two tabs) writes once.
 */
export class AcceptGuardianConsentUseCase extends BaseUseCase<
  AcceptGuardianConsentInput,
  { outcome: AcceptGuardianConsentOutcome }
> {
  constructor(
    private readonly consents: IGuardianConsentRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: AcceptGuardianConsentInput): Promise<{ outcome: AcceptGuardianConsentOutcome }> {
    const subject = await this.consents.findSubject(input.userId, input.profileId);
    // Someone else's file answers like one that does not exist (CLAUDE.md §8).
    if (!subject) {
      throw new NotFoundError({ reason: "guardian_consent.profile_not_found", message: "No such profile on this account." });
    }

    const state = guardianConsentStateOf(subject);
    if (state === "accepted") return { outcome: "already_accepted" };
    if (state === "not_required") {
      throw new UnableToProcessEntryError({
        reason: "guardian_consent.not_required",
        message: "The student is of age: there is no guardian consent to give.",
      });
    }
    if (!subject.guardian || !isGuardianAccount(subject.guardian.email, subject.accountEmail)) {
      throw new UnableToProcessEntryError({
        reason: "guardian_consent.not_guardian",
        message: "Only the guardian on file accepts the consent.",
      });
    }
    if (input.version !== CURRENT_CONSENT_VERSION) {
      throw new UnableToProcessEntryError({
        reason: "guardian_consent.outdated_version",
        message: "The consent text changed; reload to read the one in force.",
      });
    }

    const at = new Date();
    const written = await this.consents.appendIfAbsent({
      guardianId: subject.guardian.id,
      version: CURRENT_CONSENT_VERSION,
      acceptedAt: at,
      ip: input.ip,
    });
    if (!written) return { outcome: "already_accepted" };

    await this.auditLog.append({
      actorId: input.userId,
      action: "student.guardian_consent_accepted",
      targetId: subject.studentId,
      metadata: { version: CURRENT_CONSENT_VERSION },
      at,
    });
    return { outcome: "accepted" };
  }
}
