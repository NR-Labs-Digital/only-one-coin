import {
  CompleteStaffPasswordResetUseCase,
  RequestStaffPasswordResetUseCase,
  SELF_SERVICE_RESET_COOLDOWN_SECONDS,
  SELF_SERVICE_RESET_TTL_MINUTES,
  type AuditLogEntry,
  type CreateStaffPasswordResetRecord,
  type EmailNotification,
  type IAuditLogRepository,
  type IssueSelfServiceResetRecord,
  type IStaffPasswordResetLinkBuilder,
  type IStaffPasswordResetRepository,
  type IStaffPasswordSetter,
  type IStaffSessionRevoker,
  type IStaffUserLookup,
  type Locale,
  type ResettableStaffUser,
  type StaffPasswordReset,
} from "@ooc/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Forgot my password" on the panel's login (OOC-30), pure domain: fakes, no
 * database, no Better Auth. The atomic upsert itself — one pending reset per
 * user, the cooldown, the outbox row in the same transaction — is exercised
 * against Postgres in DrizzleStaffPasswordResetRepository.integration.test.ts.
 */

const STAFF: ResettableStaffUser = { id: "usr_staff", name: "Rosa Quispe", email: "rosa@onlyonecoin.edu.pe", role: "admin" };

class FakeLookup implements IStaffUserLookup {
  public asked: string[] = [];
  constructor(private readonly users: ResettableStaffUser[]) {}
  async existsByEmail() {
    return false;
  }
  async findDisplayByUserId() {
    return null;
  }
  async findResettableStaffByEmail(email: string) {
    this.asked.push(email);
    return this.users.find((user) => user.email === email) ?? null;
  }
}

/** Mirrors the adapter's contract: one pending per user, cooldown answers null. */
class FakeResetRepository implements IStaffPasswordResetRepository {
  public resets: (StaffPasswordReset & { issuedAt: Date })[] = [];
  public outbox: EmailNotification[] = [];
  public setStatusCalls: [string, StaffPasswordReset["status"]][] = [];

  async issueSelfService(record: IssueSelfServiceResetRecord, notify: (reset: StaffPasswordReset) => EmailNotification[]) {
    const pending = this.resets.find((reset) => reset.userId === record.userId && reset.status === "pending");
    let issued: StaffPasswordReset;
    if (pending) {
      if (pending.issuedAt >= record.cooldownSince) return null;
      pending.expiresAt = new Date(Math.max(pending.expiresAt.getTime(), record.expiresAt.getTime()));
      pending.issuedAt = record.requestedAt;
      issued = pending;
    } else {
      const created = {
        id: `rst_${this.resets.length + 1}`,
        userId: record.userId,
        token: record.token,
        status: "pending" as const,
        expiresAt: record.expiresAt,
        issuedAt: record.requestedAt,
      };
      this.resets.push(created);
      issued = created;
    }
    this.outbox.push(...notify(issued));
    return issued;
  }

  async create(record: CreateStaffPasswordResetRecord) {
    const created = { id: "rst_admin", status: "pending" as const, issuedAt: new Date(), ...record };
    this.resets.push(created);
    return created;
  }
  async findPendingByUserId(userId: string) {
    return this.resets.find((reset) => reset.userId === userId && reset.status === "pending") ?? null;
  }
  async findById(id: string) {
    return this.resets.find((reset) => reset.id === id) ?? null;
  }
  async findByToken(token: string) {
    return this.resets.find((reset) => reset.token === token) ?? null;
  }
  async markCompleted(id: string) {
    this.setStatusCalls.push([id, "completed"]);
    const reset = this.resets.find((r) => r.id === id);
    if (reset) reset.status = "completed";
  }
  async markCancelled(id: string) {
    this.setStatusCalls.push([id, "cancelled"]);
  }
  async renew() {}
}

class FakeLinkBuilder implements IStaffPasswordResetLinkBuilder {
  build(token: string, locale: Locale) {
    return `https://backoffice.test/${locale}/reset-password/${token}`;
  }
}

class FakeAuditLog implements IAuditLogRepository {
  public entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry) {
    this.entries.push(entry);
  }
}

class FakeSetter implements IStaffPasswordSetter {
  public calls: [string, string][] = [];
  async setPassword(userId: string, plainPassword: string) {
    this.calls.push([userId, plainPassword]);
  }
}

class FakeRevoker implements IStaffSessionRevoker {
  public revokedAll: string[] = [];
  async revokeOthers() {
    return 0;
  }
  async revokeAll(userId: string) {
    this.revokedAll.push(userId);
    return 3;
  }
}

let lookup: FakeLookup;
let repository: FakeResetRepository;
let auditLog: FakeAuditLog;
let request: RequestStaffPasswordResetUseCase;

beforeEach(() => {
  lookup = new FakeLookup([STAFF]);
  repository = new FakeResetRepository();
  auditLog = new FakeAuditLog();
  request = new RequestStaffPasswordResetUseCase(lookup, repository, new FakeLinkBuilder(), auditLog);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RequestStaffPasswordResetUseCase", () => {
  it("issues a link valid for the self-service TTL and e-mails it in the screen's language", async () => {
    const before = Date.now();
    const result = await request.run({ email: STAFF.email, locale: "pt-BR" });

    expect(result).toBeUndefined();
    expect(repository.resets).toHaveLength(1);
    const [reset] = repository.resets;
    const ttlMs = reset!.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(SELF_SERVICE_RESET_TTL_MINUTES * 60_000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(SELF_SERVICE_RESET_TTL_MINUTES * 60_000 + 1000);
    expect(reset!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(repository.outbox).toEqual([
      expect.objectContaining({
        templateKey: "staff_password_reset",
        to: STAFF.email,
        locale: "pt-BR",
        vars: { recipientName: STAFF.name, resetUrl: `https://backoffice.test/pt-BR/reset-password/${reset!.token}` },
      }),
    ]);
    expect(auditLog.entries).toEqual([
      expect.objectContaining({ actorId: STAFF.id, targetId: STAFF.id, action: "staff.password_reset_requested" }),
    ]);
  });

  it("looks the address up trimmed and lower-cased", async () => {
    await request.run({ email: "  Rosa@OnlyOneCoin.edu.pe ", locale: "es-PE" });

    expect(lookup.asked).toEqual([STAFF.email]);
    expect(repository.outbox).toHaveLength(1);
  });

  it("ends the same way, writing nothing, for an address with no panel account", async () => {
    const known = await request.run({ email: STAFF.email, locale: "es-PE" });
    repository = new FakeResetRepository();
    auditLog = new FakeAuditLog();
    request = new RequestStaffPasswordResetUseCase(lookup, repository, new FakeLinkBuilder(), auditLog);

    const unknown = await request.run({ email: "nobody@example.com", locale: "es-PE" });

    expect(unknown).toEqual(known);
    expect(repository.resets).toEqual([]);
    expect(repository.outbox).toEqual([]);
    expect(auditLog.entries).toEqual([]);
  });

  it("sends nothing more inside the cooldown, and again once it has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await request.run({ email: STAFF.email, locale: "es-PE" });
    await request.run({ email: STAFF.email, locale: "es-PE" });

    expect(repository.outbox).toHaveLength(1);
    expect(auditLog.entries).toHaveLength(1);

    vi.setSystemTime(Date.now() + (SELF_SERVICE_RESET_COOLDOWN_SECONDS + 1) * 1000);
    await request.run({ email: STAFF.email, locale: "es-PE" });

    expect(repository.resets).toHaveLength(1);
    expect(repository.outbox).toHaveLength(2);
    // Same link, so the e-mails differ only by request — never by dedupe collision.
    expect(repository.outbox[0]!.vars).toEqual(repository.outbox[1]!.vars);
    expect(repository.outbox[0]!.dedupeKey).not.toBe(repository.outbox[1]!.dedupeKey);
  });

  it("reuses the link an admin already generated instead of opening a second one", async () => {
    const adminLink = await repository.create({
      userId: STAFF.id,
      token: "admin-token",
      requestedBy: "usr_admin",
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });
    repository.resets[0]!.issuedAt = new Date(Date.now() - 3600_000);

    await request.run({ email: STAFF.email, locale: "en" });

    expect(repository.resets).toHaveLength(1);
    expect(repository.resets[0]!.expiresAt).toEqual(adminLink.expiresAt);
    expect(repository.outbox[0]!.vars).toMatchObject({ resetUrl: "https://backoffice.test/en/reset-password/admin-token" });
  });
});

describe("CompleteStaffPasswordResetUseCase", () => {
  it("sets the password, closes the link and every open session, and audits it", async () => {
    await request.run({ email: STAFF.email, locale: "es-PE" });
    const token = repository.resets[0]!.token;
    const setter = new FakeSetter();
    const revoker = new FakeRevoker();
    const complete = new CompleteStaffPasswordResetUseCase(repository, setter, revoker, auditLog);

    const result = await complete.run({ token, password: "brand-new-password-456" });

    expect(setter.calls).toEqual([[STAFF.id, "brand-new-password-456"]]);
    expect(repository.resets[0]!.status).toBe("completed");
    expect(revoker.revokedAll).toEqual([STAFF.id]);
    expect(result).toEqual({ userId: STAFF.id, sessionsClosed: 3 });
    expect(auditLog.entries.at(-1)).toMatchObject({
      action: "staff.password_reset_completed",
      metadata: { sessionsClosed: 3 },
    });
  });

  it("refuses a link that was already used", async () => {
    await request.run({ email: STAFF.email, locale: "es-PE" });
    const token = repository.resets[0]!.token;
    const complete = new CompleteStaffPasswordResetUseCase(repository, new FakeSetter(), new FakeRevoker(), auditLog);
    await complete.run({ token, password: "brand-new-password-456" });

    await expect(complete.run({ token, password: "another-password-789" })).rejects.toMatchObject({
      reason: "staff_password_reset.not_pending",
    });
  });
});
