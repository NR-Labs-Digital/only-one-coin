import {
  AcceptGuardianConsentUseCase,
  CURRENT_CONSENT_VERSION,
  guardianConsentStateOf,
  isGuardianAccount,
  type AuditLogEntry,
  type GuardianConsentSubject,
  type IAuditLogRepository,
  type IGuardianConsentRepository,
  type NewGuardianConsent,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/** The guardian's consent in the portal (OOC-72), pure domain. */

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
};

describe("guardianConsentStateOf", () => {
  it("is not required of a student of age, given or not", () => {
    expect(guardianConsentStateOf({ birthDate: yearsAgo(20), consentGiven: false })).toBe("not_required");
  });

  it("is pending for a minor without a consent on record", () => {
    expect(guardianConsentStateOf({ birthDate: yearsAgo(12), consentGiven: false })).toBe("pending");
    expect(guardianConsentStateOf({ birthDate: yearsAgo(12), consentGiven: true })).toBe("accepted");
  });
});

describe("isGuardianAccount", () => {
  it("compares the addresses without case or surrounding spaces", () => {
    expect(isGuardianAccount(" Rosa.Quispe@Hotmail.com ", "rosa.quispe@hotmail.com")).toBe(true);
    expect(isGuardianAccount("rosa@hotmail.com", "ana@gmail.com")).toBe(false);
    expect(isGuardianAccount(null, "ana@gmail.com")).toBe(false);
  });
});

const STUDENT = "018f2b5c-0000-7000-8000-000000000001";
const GUARDIAN = "018f2b5c-0000-7000-8000-000000000002";

class FakeConsents implements IGuardianConsentRepository {
  public subject: GuardianConsentSubject | null = {
    studentId: STUDENT,
    birthDate: yearsAgo(12),
    guardian: { id: GUARDIAN, email: "rosa@hotmail.com" },
    consentGiven: false,
    accountEmail: "rosa@hotmail.com",
  };
  public written: NewGuardianConsent[] = [];
  public asked: [string, string][] = [];
  async findSubject(userId: string, profileId: string) {
    this.asked.push([userId, profileId]);
    return this.subject;
  }
  async appendIfAbsent(consent: NewGuardianConsent) {
    if (this.written.length > 0) return false;
    this.written.push(consent);
    return true;
  }
}

class FakeAudit implements IAuditLogRepository {
  public entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

describe("AcceptGuardianConsentUseCase", () => {
  let consents: FakeConsents;
  let audit: FakeAudit;
  const input = { userId: "usr_rosa", profileId: STUDENT, version: CURRENT_CONSENT_VERSION, ip: "200.48.1.1" };
  const run = (overrides: Partial<typeof input> = {}) =>
    new AcceptGuardianConsentUseCase(consents, audit).run({ ...input, ...overrides });

  beforeEach(() => {
    consents = new FakeConsents();
    audit = new FakeAudit();
  });

  it("records the guardian's consent with the version, the date and the IP, and audits it", async () => {
    await expect(run()).resolves.toEqual({ outcome: "accepted" });
    expect(consents.asked).toEqual([["usr_rosa", STUDENT]]);
    expect(consents.written).toEqual([
      { guardianId: GUARDIAN, version: CURRENT_CONSENT_VERSION, acceptedAt: expect.any(Date), ip: "200.48.1.1" },
    ]);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        actorId: "usr_rosa",
        action: "student.guardian_consent_accepted",
        targetId: STUDENT,
        metadata: { version: CURRENT_CONSENT_VERSION },
      }),
    ]);
  });

  it("writes once when accepted twice", async () => {
    await run();
    await expect(run()).resolves.toEqual({ outcome: "already_accepted" });
    expect(consents.written).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
  });

  it("answers an already given consent without writing", async () => {
    consents.subject = { ...consents.subject!, consentGiven: true };
    await expect(run()).resolves.toEqual({ outcome: "already_accepted" });
    expect(consents.written).toEqual([]);
  });

  it("answers a profile the account does not reach like one that does not exist", async () => {
    consents.subject = null;
    await expect(run()).rejects.toMatchObject({ status: 404, reason: "guardian_consent.profile_not_found" });
  });

  it("never lets the student's own account accept", async () => {
    consents.subject = { ...consents.subject!, accountEmail: "ana.quispe@gmail.com" };
    await expect(run()).rejects.toMatchObject({ status: 422, reason: "guardian_consent.not_guardian" });
    expect(consents.written).toEqual([]);
  });

  it("refuses a file with no guardian on record", async () => {
    consents.subject = { ...consents.subject!, guardian: null };
    await expect(run()).rejects.toMatchObject({ status: 422, reason: "guardian_consent.not_guardian" });
  });

  it("has nothing to accept for a student of age", async () => {
    consents.subject = { ...consents.subject!, birthDate: yearsAgo(19) };
    await expect(run()).rejects.toMatchObject({ status: 422, reason: "guardian_consent.not_required" });
  });

  it("refuses a text version that is not the one in force", async () => {
    await expect(run({ version: "v0" })).rejects.toMatchObject({ status: 422, reason: "guardian_consent.outdated_version" });
    expect(consents.written).toEqual([]);
  });
});
