import {
  CompletePortalAccessUseCase,
  IssuePortalAccessUseCase,
  PORTAL_ACTIVATION_TTL_DAYS,
  PORTAL_RESET_TTL_MINUTES,
  PORTAL_SIGN_IN_SENTINEL_EMAIL,
  RequestPortalPasswordResetUseCase,
  ResolvePortalSignInEmailUseCase,
  hashPortalToken,
  newPortalToken,
  parsePortalIdentifier,
  portalCredentialsEmail,
  portalPasswordResetEmail,
  type AuditLogEntry,
  type EmailNotification,
  type IAuditLogRepository,
  type IPortalAccessRepository,
  type IPortalLinkBuilder,
  type IPortalPasswordSetter,
  type IStaffSessionRevoker,
  type IssuePortalTokenRequest,
  type Locale,
  type PortalAccessToken,
  type PortalAccount,
  type PortalAccountProvisioning,
  type PortalGuardianAccessRequest,
  type PortalIdentifier,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Student portal access (05/10/2026), pure domain: the identifier rules, the
 * one-time tokens and the two e-mails. Use cases are further down this file.
 */

const ACCOUNT: PortalAccount = { userId: "usr_ana", email: "ana.quispe@gmail.com", name: "Ana Quispe", hasPassword: false };

describe("parsePortalIdentifier", () => {
  it("normalizes an e-mail", () => {
    expect(parsePortalIdentifier({ method: "email", identifier: "  Ana.Quispe@Gmail.com " })).toEqual({
      method: "email",
      email: "ana.quispe@gmail.com",
    });
  });

  it("normalizes a document and checks it against its type", () => {
    expect(parsePortalIdentifier({ method: "national_id", nationalIdType: "DNI", identifier: "12.345.678" })).toEqual({
      method: "national_id",
      nationalIdType: "DNI",
      nationalId: "12345678",
    });
  });

  it.each([
    [{ method: "email", identifier: "not-an-email" }],
    [{ method: "national_id", nationalIdType: "DNI", identifier: "1234" }],
    [{ method: "national_id", identifier: "12345678" }],
    [{ method: "national_id", nationalIdType: "RUC", identifier: "12345678" }],
    [{ method: "phone", identifier: "999999999" }],
    [{ identifier: "ana@gmail.com" }],
    [null],
    ["ana@gmail.com"],
  ])("refuses %j", (raw) => {
    expect(parsePortalIdentifier(raw)).toBeNull();
  });
});

describe("portal tokens", () => {
  it("are random, url-safe, stored only as a hash", () => {
    const a = newPortalToken("activation");
    const b = newPortalToken("activation");
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashPortalToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("last seven days to activate and one hour to reset", () => {
    const now = new Date("2026-10-05T12:00:00.000Z");
    expect(newPortalToken("activation", now).expiresAt.getTime() - now.getTime()).toBe(PORTAL_ACTIVATION_TTL_DAYS * 86_400_000);
    expect(newPortalToken("reset", now).expiresAt.getTime() - now.getTime()).toBe(PORTAL_RESET_TTL_MINUTES * 60_000);
  });
});

describe("portal e-mails", () => {
  it("send the credentials to the student only, with a link and never a password", () => {
    expect(portalCredentialsEmail(ACCOUNT, "https://student.test/access/t", "tok_1", "es-PE")).toEqual({
      templateKey: "portal_credentials",
      to: ACCOUNT.email,
      locale: "es-PE",
      vars: { recipientName: "Ana Quispe", loginEmail: ACCOUNT.email, accessUrl: "https://student.test/access/t" },
      dedupeKey: "portal_credentials:usr_ana:tok_1",
    });
  });

  it("send the reset link to the account's address", () => {
    expect(portalPasswordResetEmail(ACCOUNT, "https://student.test/access/r", "tok_2", "pt-BR")).toEqual({
      templateKey: "portal_password_reset",
      to: ACCOUNT.email,
      locale: "pt-BR",
      vars: { recipientName: "Ana Quispe", resetUrl: "https://student.test/access/r" },
      dedupeKey: "portal_password_reset:usr_ana:tok_2",
    });
  });
});

class FakePortalRepository implements IPortalAccessRepository {
  public accounts = new Map<string, PortalAccount>(); // by studentId
  public byIdentifier: PortalAccount | null = null;
  public confirmed = true;
  public tokens: (PortalAccessToken & { hash: string; createdAt: Date })[] = [];
  public outbox: EmailNotification[] = [];
  public provisioned: PortalAccountProvisioning[] = [];
  public provisionOutcome: Awaited<ReturnType<IPortalAccessRepository["provision"]>> = "created";

  async provision(request: PortalAccountProvisioning) {
    this.provisioned.push(request);
    if (this.provisionOutcome === "created") {
      const account = { userId: "usr_new", email: "ana@gmail.com", name: "Ana Quispe", hasPassword: false };
      this.accounts.set(request.studentId, account);
      this.outbox.push(...request.notify(account, "tok_created"));
    }
    if (this.provisionOutcome === "linked_existing") {
      this.accounts.set(request.studentId, { userId: "usr_twin", email: "ana@gmail.com", name: "Ana Quispe", hasPassword: true });
    }
    return this.provisionOutcome;
  }
  async findAccountByStudent(studentId: string) {
    return this.accounts.get(studentId) ?? null;
  }
  async findAccountByIdentifier(_identifier: PortalIdentifier) {
    return this.byIdentifier;
  }
  async hasConfirmedEnrollment() {
    return this.confirmed;
  }
  async issueToken(request: IssuePortalTokenRequest) {
    if (request.cooldownSince && this.tokens.some((t) => t.userId === request.userId && t.createdAt > request.cooldownSince!)) return null;
    const id = `tok_${this.tokens.length + 1}`;
    this.tokens.push({ id, userId: request.userId, purpose: request.token.purpose, expiresAt: request.token.expiresAt, usedAt: null, hash: request.token.tokenHash, createdAt: new Date() });
    this.outbox.push(...request.notify(id));
    return { id };
  }
  async findToken(tokenHash: string) {
    return this.tokens.find((t) => t.hash === tokenHash) ?? null;
  }
  async consumeToken(id: string) {
    const token = this.tokens.find((t) => t.id === id);
    if (!token || token.usedAt || token.expiresAt <= new Date()) return false;
    token.usedAt = new Date();
    return true;
  }
  async findIdentity() {
    return null;
  }
  async accessState() {
    return "none" as const;
  }
  public consentPending = false;
  public guardianDoors: PortalGuardianAccessRequest[] = [];
  public guardianDoor: Awaited<ReturnType<IPortalAccessRepository["openGuardianAccess"]>> = { outcome: "not_applicable", account: null };
  async openGuardianAccess(request: PortalGuardianAccessRequest) {
    this.guardianDoors.push(request);
    if (this.guardianDoor.outcome === "created") {
      this.outbox.push(...request.guardian.notify({ userId: "usr_mom", email: "mama@hotmail.com", name: "Rosa Quispe", hasPassword: false }, "tok_mom"));
    }
    return this.guardianDoor;
  }
  async guardianConsentPending() {
    return this.consentPending;
  }
}

class FakeLinks implements IPortalLinkBuilder {
  access(token: string, locale: Locale) {
    return `https://student.test/${locale}/access/${token}`;
  }
}
class FakeAudit implements IAuditLogRepository {
  public entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}
class FakeSetter implements IPortalPasswordSetter {
  public calls: [string, string][] = [];
  async setPassword(userId: string, password: string) {
    this.calls.push([userId, password]);
  }
}
class FakeRevoker implements IStaffSessionRevoker {
  public revoked: string[] = [];
  async revokeOthers() {
    return 0;
  }
  async revokeAll(userId: string) {
    this.revoked.push(userId);
    return 2;
  }
}

const WITH_PASSWORD: PortalAccount = { ...ACCOUNT, hasPassword: true };

let repo: FakePortalRepository;
let audit: FakeAudit;
beforeEach(() => {
  repo = new FakePortalRepository();
  audit = new FakeAudit();
});

describe("ResolvePortalSignInEmailUseCase", () => {
  it("hands sign-in the account's address", async () => {
    repo.byIdentifier = ACCOUNT;
    const email = await new ResolvePortalSignInEmailUseCase(repo).run({
      identifier: { method: "national_id", nationalIdType: "DNI", nationalId: "12345678" },
    });
    expect(email).toBe(ACCOUNT.email);
  });

  it("hands it the sentinel for an unknown or malformed identifier", async () => {
    const useCase = new ResolvePortalSignInEmailUseCase(repo);
    expect(await useCase.run({ identifier: { method: "email", email: "nobody@gmail.com" } })).toBe(PORTAL_SIGN_IN_SENTINEL_EMAIL);
    expect(await useCase.run({ identifier: null })).toBe(PORTAL_SIGN_IN_SENTINEL_EMAIL);
  });
});

describe("RequestPortalPasswordResetUseCase", () => {
  const byEmail: PortalIdentifier = { method: "email", email: ACCOUNT.email };

  it("e-mails a one-hour reset link to an account that has a password", async () => {
    repo.byIdentifier = WITH_PASSWORD;
    await new RequestPortalPasswordResetUseCase(repo, new FakeLinks(), audit).run({ identifier: byEmail, locale: "pt-BR" });

    expect(repo.tokens.map((t) => t.purpose)).toEqual(["reset"]);
    expect(repo.outbox).toEqual([expect.objectContaining({ templateKey: "portal_password_reset", to: ACCOUNT.email, locale: "pt-BR" })]);
    expect(audit.entries).toEqual([expect.objectContaining({ action: "portal.password_reset_requested", targetId: ACCOUNT.userId })]);
  });

  it("re-sends the activation to an account that never set one", async () => {
    repo.byIdentifier = ACCOUNT;
    await new RequestPortalPasswordResetUseCase(repo, new FakeLinks(), audit).run({ identifier: byEmail, locale: "es-PE" });
    expect(repo.tokens.map((t) => t.purpose)).toEqual(["activation"]);
    expect(repo.outbox.map((m) => m.templateKey)).toEqual(["portal_credentials"]);
  });

  it("ends the same way, writing nothing, for no account or a malformed identifier", async () => {
    const useCase = new RequestPortalPasswordResetUseCase(repo, new FakeLinks(), audit);
    expect(await useCase.run({ identifier: byEmail, locale: "es-PE" })).toBeUndefined();
    expect(await useCase.run({ identifier: null, locale: "es-PE" })).toBeUndefined();
    expect(repo.tokens).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("sends one e-mail inside the cooldown", async () => {
    repo.byIdentifier = WITH_PASSWORD;
    const useCase = new RequestPortalPasswordResetUseCase(repo, new FakeLinks(), audit);
    await useCase.run({ identifier: byEmail, locale: "es-PE" });
    await useCase.run({ identifier: byEmail, locale: "es-PE" });
    expect(repo.outbox).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
  });
});

describe("CompletePortalAccessUseCase", () => {
  async function issue(purpose: "activation" | "reset", expiresAt?: Date) {
    const token = newPortalToken(purpose);
    if (expiresAt) token.expiresAt = expiresAt;
    await repo.issueToken({ userId: ACCOUNT.userId, token, cooldownSince: null, notify: () => [] });
    return token.token;
  }

  it("sets the password, burns the link, closes every session and audits", async () => {
    const setter = new FakeSetter();
    const revoker = new FakeRevoker();
    const token = await issue("activation");

    const result = await new CompletePortalAccessUseCase(repo, setter, revoker, audit).run({ token, password: "nueva-clave-1" });

    expect(result).toEqual({ userId: ACCOUNT.userId, purpose: "activation" });
    expect(setter.calls).toEqual([[ACCOUNT.userId, "nueva-clave-1"]]);
    expect(revoker.revoked).toEqual([ACCOUNT.userId]);
    expect(audit.entries).toEqual([expect.objectContaining({ action: "portal.password_set", metadata: { purpose: "activation", sessionsClosed: 2 } })]);
    await expect(new CompletePortalAccessUseCase(repo, setter, revoker, audit).run({ token, password: "otra-clave-12" })).rejects.toMatchObject({
      status: 410,
      reason: "portal_access.link_invalid",
    });
  });

  it("refuses an unknown or expired link with the same answer", async () => {
    const useCase = new CompletePortalAccessUseCase(repo, new FakeSetter(), new FakeRevoker(), audit);
    await expect(useCase.run({ token: "nope", password: "nueva-clave-1" })).rejects.toMatchObject({ status: 410, reason: "portal_access.link_invalid" });
    const expired = await issue("reset", new Date(Date.now() - 1000));
    await expect(useCase.run({ token: expired, password: "nueva-clave-1" })).rejects.toMatchObject({ status: 410, reason: "portal_access.link_invalid" });
  });

  it("refuses a weak password and keeps the link alive", async () => {
    const setter = new FakeSetter();
    const token = await issue("reset");
    const useCase = new CompletePortalAccessUseCase(repo, setter, new FakeRevoker(), audit);
    await expect(useCase.run({ token, password: "corta1" })).rejects.toMatchObject({ status: 422, reason: "portal_access.weak_password" });
    expect(setter.calls).toEqual([]);
    await expect(useCase.run({ token, password: "nueva-clave-1" })).resolves.toMatchObject({ purpose: "reset" });
  });
});

describe("IssuePortalAccessUseCase", () => {
  const STUDENT = "018f2b5c-0000-7000-8000-00000000s001";

  it("creates the account when there is none", async () => {
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "created", guardian: null });
    expect(repo.outbox.map((m) => m.templateKey)).toEqual(["portal_credentials"]);
    expect(audit.entries).toEqual([expect.objectContaining({ action: "portal_access.issued", targetId: STUDENT, metadata: { outcome: "created" } })]);
    // The guardian's door opens with the student's account, as on an approval (OOC-147).
    expect(repo.guardianDoors).toHaveLength(1);
  });

  it("opens the guardian's account with a new student account and says so", async () => {
    repo.guardianDoor = { outcome: "created", account: null };
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "created", guardian: "created" });
    expect(repo.outbox.map((m) => m.to)).toEqual(["ana@gmail.com", "mama@hotmail.com"]);
    expect(audit.entries[0]?.metadata).toEqual({ outcome: "created", guardian: "created" });
  });

  describe("on a file that already has an account (OOC-72)", () => {
    const MOM: PortalAccount = { userId: "usr_mom", email: "mama@hotmail.com", name: "Rosa Quispe", hasPassword: false };

    beforeEach(() => {
      repo.accounts.set(STUDENT, ACCOUNT);
    });

    it("leaves the guardian alone once the consent is given", async () => {
      repo.guardianDoor = { outcome: "created", account: null };
      const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
      expect(result).toEqual({ outcome: "activation_resent", guardian: null });
      expect(repo.guardianDoors).toEqual([]);
    });

    it("opens the guardian's account while a minor's consent is pending", async () => {
      repo.consentPending = true;
      repo.guardianDoor = { outcome: "created", account: null };
      const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
      expect(result).toEqual({ outcome: "activation_resent", guardian: "created" });
      expect(repo.outbox.map((m) => m.to)).toEqual([ACCOUNT.email, "mama@hotmail.com"]);
    });

    it("re-sends the guardian's activation when their account has no password yet", async () => {
      repo.consentPending = true;
      repo.guardianDoor = { outcome: "already_linked", account: MOM };
      const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
      expect(result.guardian).toBe("activation_resent");
      expect(repo.tokens.filter((t) => t.userId === MOM.userId).map((t) => t.purpose)).toEqual(["activation"]);
    });

    it("never resets the guardian's password: an active guardian accepts at the next sign-in", async () => {
      repo.consentPending = true;
      repo.guardianDoor = { outcome: "already_linked", account: { ...MOM, hasPassword: true } };
      const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
      expect(result.guardian).toBe("active");
      expect(repo.tokens.filter((t) => t.userId === MOM.userId)).toEqual([]);
    });

    it("reports a guardian address held by staff", async () => {
      repo.consentPending = true;
      repo.guardianDoor = { outcome: "conflict", account: null };
      const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
      expect(result.guardian).toBe("conflict");
    });
  });

  it("re-sends the activation to an account still without a password", async () => {
    repo.accounts.set(STUDENT, ACCOUNT);
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "activation_resent", guardian: null });
    expect(repo.tokens.map((t) => t.purpose)).toEqual(["activation"]);
  });

  it("sends a reset link to an active account", async () => {
    repo.accounts.set(STUDENT, WITH_PASSWORD);
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "reset_sent", guardian: null });
    expect(repo.outbox.map((m) => m.templateKey)).toEqual(["portal_password_reset"]);
  });

  it("e-mails the account a duplicate file was just linked to", async () => {
    repo.provisionOutcome = "linked_existing";
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "reset_sent", guardian: null });
  });

  it("reports an e-mail conflict and sends nothing", async () => {
    repo.provisionOutcome = "email_conflict";
    const result = await new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT });
    expect(result).toEqual({ outcome: "email_conflict", guardian: null });
    expect(repo.outbox).toEqual([]);
  });

  it("refuses a student with no confirmed seat", async () => {
    repo.confirmed = false;
    await expect(new IssuePortalAccessUseCase(repo, new FakeLinks(), audit).run({ actorId: "usr_admin", studentId: STUDENT })).rejects.toMatchObject({
      status: 422,
      reason: "portal_access.no_confirmed_enrollment",
    });
  });
});
