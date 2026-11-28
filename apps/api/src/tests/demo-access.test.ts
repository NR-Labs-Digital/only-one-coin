import {
  CreateDemoAccessUseCase,
  DemoEmailInUseError,
  DemoStudentEmailNotGmailError,
  NotAPlatformOwnerError,
  RevokeDemoAccessUseCase,
  DemoAccessNotFoundError,
  type CreateStaffInviteUseCase,
  type IAuditLogRepository,
  type IDemoAccessRepository,
  type IssuePortalAccessUseCase,
} from "@ooc/domain";
import { describe, expect, it, vi } from "vitest";

/**
 * The owners' demo accesses (28/11/2026): who may open one, which address a
 * student's needs, and which door the account goes through. The rows
 * themselves are DemoAccess.integration.test.ts.
 */

function setup(overrides: Partial<IDemoAccessRepository> = {}) {
  const demos: IDemoAccessRepository = {
    emailInUse: vi.fn().mockResolvedValue(false),
    createStudentKit: vi.fn().mockResolvedValue({ accessId: "acc-s", classGroupId: "cg", ownerId: "stu" }),
    createTeacherKit: vi.fn().mockResolvedValue({ accessId: "acc-t", classGroupId: "cg", ownerId: "tea" }),
    revoke: vi.fn().mockResolvedValue({ kind: "student", classGroupId: "cg" }),
    list: vi.fn().mockResolvedValue([]),
    courseOptions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const issuePortalAccess = { run: vi.fn().mockResolvedValue({ outcome: "created", guardian: null }) };
  const createStaffInvite = { run: vi.fn().mockResolvedValue({ invite: { id: "inv" } }) };
  const auditLog: IAuditLogRepository = { append: vi.fn().mockResolvedValue(undefined) } as unknown as IAuditLogRepository;
  const create = new CreateDemoAccessUseCase(
    demos,
    issuePortalAccess as unknown as IssuePortalAccessUseCase,
    createStaffInvite as unknown as CreateStaffInviteUseCase,
    auditLog,
  );
  const revoke = new RevokeDemoAccessUseCase(demos, auditLog);
  return { demos, issuePortalAccess, createStaffInvite, auditLog, create, revoke };
}

const OWNER = { actorId: "u1", actorEmail: "miguel@nrlabsdigital.com", actorPermissions: new Set<string>() };
const STUDENT = { ...OWNER, kind: "student" as const, email: "Cliente.Demo@Gmail.com", firstName: " Rick ", lastName: "Demo", courseId: "c1" };

describe("CreateDemoAccessUseCase", () => {
  it("refuses an account outside the owners' domains, whatever the cargo", async () => {
    const { create, demos } = setup();
    await expect(create.run({ ...STUDENT, actorEmail: "admin@onlyonecoin.edu.pe" })).rejects.toBeInstanceOf(NotAPlatformOwnerError);
    expect(demos.createStudentKit).not.toHaveBeenCalled();
  });

  it("opens a student's demo on a Gmail and sends the portal access, never a password", async () => {
    const { create, demos, issuePortalAccess, auditLog } = setup();
    const result = await create.run(STUDENT);

    expect(result).toEqual({ accessId: "acc-s" });
    expect(demos.createStudentKit).toHaveBeenCalledWith(
      expect.objectContaining({ email: "cliente.demo@gmail.com", firstName: "Rick", courseId: "c1" }),
    );
    expect(issuePortalAccess.run).toHaveBeenCalledWith({ actorId: "u1", studentId: "stu" });
    const entry = vi.mocked(auditLog.append).mock.calls[0]![0];
    expect(entry.action).toBe("demo_access.created");
    expect(JSON.stringify(entry.metadata)).not.toContain("gmail");
  });

  it("holds a student's demo to the student rule: a personal Gmail", async () => {
    const { create } = setup();
    await expect(create.run({ ...STUDENT, email: "rick@onlyonecoin.edu.pe" })).rejects.toBeInstanceOf(DemoStudentEmailNotGmailError);
    await expect(create.run({ ...STUDENT, email: "ab@gmail.com" })).rejects.toBeInstanceOf(DemoStudentEmailNotGmailError);
  });

  it("refuses an address the platform already uses", async () => {
    const { create, demos } = setup({ emailInUse: vi.fn().mockResolvedValue(true) });
    await expect(create.run(STUDENT)).rejects.toBeInstanceOf(DemoEmailInUseError);
    expect(demos.createStudentKit).not.toHaveBeenCalled();
  });

  it("opens a teacher's demo on any provider through the teacher invite tied to the file", async () => {
    const { create, createStaffInvite, issuePortalAccess } = setup();
    await create.run({ ...STUDENT, kind: "teacher", email: "rick@onlyonecoin.edu.pe" });

    expect(createStaffInvite.run).toHaveBeenCalledWith(
      expect.objectContaining({ role: "teacher", teacherId: "tea", email: "rick@onlyonecoin.edu.pe" }),
    );
    expect(issuePortalAccess.run).not.toHaveBeenCalled();
  });
});

describe("RevokeDemoAccessUseCase", () => {
  it("is the owners' alone", async () => {
    const { revoke } = setup();
    await expect(revoke.run({ actorId: "u1", actorEmail: "x@onlyonecoin.edu.pe", accessId: "a" })).rejects.toBeInstanceOf(
      NotAPlatformOwnerError,
    );
  });

  it("answers 404 for an access already revoked or unknown", async () => {
    const { revoke } = setup({ revoke: vi.fn().mockResolvedValue(null) });
    await expect(revoke.run({ actorId: "u1", actorEmail: "x@admin.com", accessId: "a" })).rejects.toBeInstanceOf(DemoAccessNotFoundError);
  });
});
