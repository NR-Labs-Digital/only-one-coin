import {
  ConfirmOwnMfaEnrollmentUseCase,
  CurrentPasswordIncorrectError,
  DisableOwnMfaUseCase,
  MfaAlreadyEnabledError,
  MfaCodeRejectedError,
  MfaNotEnabledError,
  MfaRequiredForRoleError,
  RegenerateOwnRecoveryCodesUseCase,
  StartOwnMfaEnrollmentUseCase,
  requiresMfa,
  type AuditLogEntry,
  type ConfirmMfaEnrollmentResult,
  type IAuditLogRepository,
  type IFreshAuthVerifier,
  type IStaffSecondFactor,
  type Locale,
  type StaffMfaState,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The staff second factor (OOC-29). Pure domain here — fakes, no database,
 * no Better Auth. What the usecases promise: the cargo rule (no switch for
 * master/admin/billing), the password asked again where it matters, and an
 * audit entry for every change.
 */

const USER = "usr_staff";
const SESSION = "session-token";
const PASSWORD = "the-password-123";
const GOOD_CODE = "123456";

class FakeVerifier implements IFreshAuthVerifier {
  async verify(_userId: string, plainPassword: string) {
    return plainPassword === PASSWORD;
  }
}

class FakeSecondFactor implements IStaffSecondFactor {
  public current: StaffMfaState = { enabled: false, recoveryCodesLeft: 0 };
  public sent: [string, Locale][] = [];
  public disabled = 0;

  async state() {
    return { ...this.current };
  }
  async sendEnrollmentCode(sessionToken: string, locale: Locale) {
    this.sent.push([sessionToken, locale]);
  }
  async confirmEnrollment(_sessionToken: string, code: string): Promise<ConfirmMfaEnrollmentResult> {
    if (code !== GOOD_CODE) return { ok: false, reason: "staff_mfa.code_invalid" };
    this.current = { enabled: true, recoveryCodesLeft: 0 };
    return { ok: true, sessionCookies: ["better-auth.session_token=new"] };
  }
  async replaceRecoveryCodes() {
    const codes = Array.from({ length: 10 }, (_, i) => `code${i}-xxxxx`);
    this.current = { ...this.current, recoveryCodesLeft: codes.length };
    return codes;
  }
  async disable() {
    this.disabled += 1;
    this.current = { enabled: false, recoveryCodesLeft: 0 };
  }
}

class FakeAuditLog implements IAuditLogRepository {
  public entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

let secondFactor: FakeSecondFactor;
let auditLog: FakeAuditLog;

beforeEach(() => {
  secondFactor = new FakeSecondFactor();
  auditLog = new FakeAuditLog();
});

describe("requiresMfa", () => {
  it("is mandatory for the cargos that move money or hand out cargos (CLAUDE.md §8)", () => {
    expect(["master", "admin", "billing"].every((role) => requiresMfa(role as "admin"))).toBe(true);
  });

  it("is optional for every other staff cargo", () => {
    const optional = ["analyst", "enrollment_supervisor", "academic_supervisor", "teacher", "sales", "support"] as const;
    expect(optional.some((role) => requiresMfa(role))).toBe(false);
  });
});

describe("StartOwnMfaEnrollmentUseCase", () => {
  it("e-mails a code bound to the session, in the screen's language", async () => {
    await new StartOwnMfaEnrollmentUseCase(secondFactor).run({ userId: USER, sessionToken: SESSION, locale: "pt-BR" });
    expect(secondFactor.sent).toEqual([[SESSION, "pt-BR"]]);
  });

  it("refuses when the factor is already on", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 10 };
    await expect(
      new StartOwnMfaEnrollmentUseCase(secondFactor).run({ userId: USER, sessionToken: SESSION, locale: "es-PE" }),
    ).rejects.toBeInstanceOf(MfaAlreadyEnabledError);
    expect(secondFactor.sent).toEqual([]);
  });
});

describe("ConfirmOwnMfaEnrollmentUseCase", () => {
  it("turns the factor on, hands back the recovery codes once and the new session, and audits it", async () => {
    const result = await new ConfirmOwnMfaEnrollmentUseCase(secondFactor, auditLog).run({
      userId: USER,
      sessionToken: SESSION,
      code: GOOD_CODE,
    });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.sessionCookies).toEqual(["better-auth.session_token=new"]);
    expect(secondFactor.current).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect(auditLog.entries).toMatchObject([{ actorId: USER, action: "staff.mfa_enabled", targetId: USER }]);
  });

  it("refuses a wrong code with its reason and changes nothing", async () => {
    const run = new ConfirmOwnMfaEnrollmentUseCase(secondFactor, auditLog).run({
      userId: USER,
      sessionToken: SESSION,
      code: "000000",
    });

    await expect(run).rejects.toBeInstanceOf(MfaCodeRejectedError);
    await expect(run).rejects.toMatchObject({ reason: "staff_mfa.code_invalid" });
    expect(secondFactor.current.enabled).toBe(false);
    expect(auditLog.entries).toEqual([]);
  });

  it("refuses when the factor is already on", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 3 };
    await expect(
      new ConfirmOwnMfaEnrollmentUseCase(secondFactor, auditLog).run({ userId: USER, sessionToken: SESSION, code: GOOD_CODE }),
    ).rejects.toBeInstanceOf(MfaAlreadyEnabledError);
  });
});

describe("RegenerateOwnRecoveryCodesUseCase", () => {
  const useCase = () => new RegenerateOwnRecoveryCodesUseCase(new FakeVerifier(), secondFactor, auditLog);

  it("asks for the password again", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 2 };
    await expect(useCase().run({ userId: USER, password: "wrong" })).rejects.toBeInstanceOf(CurrentPasswordIncorrectError);
    expect(secondFactor.current.recoveryCodesLeft).toBe(2);
  });

  it("replaces the set and audits how many were left", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 2 };
    const result = await useCase().run({ userId: USER, password: PASSWORD });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(auditLog.entries).toMatchObject([
      { action: "staff.mfa_recovery_codes_regenerated", metadata: { codesLeftBefore: 2 } },
    ]);
  });

  it("refuses when the factor is off", async () => {
    await expect(useCase().run({ userId: USER, password: PASSWORD })).rejects.toBeInstanceOf(MfaNotEnabledError);
  });
});

describe("DisableOwnMfaUseCase", () => {
  const useCase = () => new DisableOwnMfaUseCase(new FakeVerifier(), secondFactor, auditLog);

  it.each(["master", "admin", "billing"] as const)("never turns it off for %s, even with the right password", async (role) => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 10 };
    await expect(useCase().run({ userId: USER, role, password: PASSWORD })).rejects.toBeInstanceOf(MfaRequiredForRoleError);
    expect(secondFactor.disabled).toBe(0);
    expect(auditLog.entries).toEqual([]);
  });

  it("turns it off for an optional cargo with the password, and audits it", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 10 };
    await useCase().run({ userId: USER, role: "teacher", password: PASSWORD });

    expect(secondFactor.disabled).toBe(1);
    expect(auditLog.entries).toMatchObject([{ action: "staff.mfa_disabled", targetId: USER }]);
  });

  it("asks for the password again", async () => {
    secondFactor.current = { enabled: true, recoveryCodesLeft: 10 };
    await expect(useCase().run({ userId: USER, role: "sales", password: "wrong" })).rejects.toBeInstanceOf(
      CurrentPasswordIncorrectError,
    );
    expect(secondFactor.disabled).toBe(0);
  });
});
