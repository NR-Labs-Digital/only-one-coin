/**
 * One profile of a portal account, as far as the guardian's consent goes
 * (OOC-72). `studentId` is the profile's file — the newest of the person's
 * files the account reaches (OOC-147).
 */
export interface GuardianConsentSubject {
  studentId: string;
  birthDate: Date;
  /** The file's live guardian; null when there is none. */
  guardian: { id: string; email: string } | null;
  /** The live guardian has at least one consent on record. */
  consentGiven: boolean;
  /** The signed-in account's own e-mail. */
  accountEmail: string;
}

export interface NewGuardianConsent {
  guardianId: string;
  version: string;
  acceptedAt: Date;
  ip: string;
}

export interface IGuardianConsentRepository {
  /**
   * The profile `profileId` names among the account's own — exactly, with no
   * fallback to the default profile: accepting for the wrong child is the one
   * thing this must never do. Null when the id is not one of them.
   */
  findSubject(userId: string, profileId: string): Promise<GuardianConsentSubject | null>;
  /**
   * Appends the consent (the table is append-only), unless the guardian
   * already has one — then nothing is written and the answer is `false`.
   */
  appendIfAbsent(consent: NewGuardianConsent): Promise<boolean>;
}
