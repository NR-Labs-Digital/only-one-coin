import {
  ClassroomAccount,
  ClassroomAccountInUseError,
  ClassroomAccountTeacherInactiveError,
  ClassroomCredentialsUnavailableError,
  CreateClassroomAccountUseCase,
  GetOwnClassroomAccessUseCase,
  InvalidFieldsError,
  RetireClassroomAccountUseCase,
  RevealClassroomAccountPasswordUseCase,
  Teacher,
  UpdateClassroomAccountUseCase,
  UpdateTeacherUseCase,
  type ClassroomAccountWrite,
  type IClassroomAccountRepository,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { AesGcmCredentialCipher } from "@/infra/crypto/AesGcmCredentialCipher.js";
import { FakeAuditLogRepository } from "./fakes/catalog.js";
import { FakePlatformSettings } from "./fakes/platformSettings.js";
import { FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * OOC-196: the shared Classroom logins. The password is sealed, never stored
 * or audited in clear, and the teacher sees only the account their own file
 * points at.
 */

const SECRET = "a".repeat(40);

class FakeClassroomAccounts implements IClassroomAccountRepository {
  rows = new Map<string, ClassroomAccount>();
  teachersOn = new Map<string, number>();
  async create(account: ClassroomAccount) {
    this.rows.set(account.id, account);
  }
  async findById(id: string) {
    const row = this.rows.get(id);
    return row && !row.isDeleted ? row : null;
  }
  async update(account: ClassroomAccount) {
    this.rows.set(account.id, account);
  }
  async countTeachers(id: string) {
    return this.teachersOn.get(id) ?? 0;
  }
  async retire(account: ClassroomAccount) {
    this.rows.set(account.id, account);
  }
}

function teacher(userId: string | null, classroomAccountId: string | null): Teacher {
  return new Teacher({
    ...Teacher.createPending({ firstName: "Ana", lastName: "Quispe", personalEmail: "ana@example.com", languages: [] }),
    userId,
    classroomAccountId,
  });
}

function setup() {
  const accounts = new FakeClassroomAccounts();
  const cipher = new AesGcmCredentialCipher(SECRET);
  const audit = new FakeAuditLogRepository();
  return {
    accounts,
    cipher,
    audit,
    create: new CreateClassroomAccountUseCase(accounts, cipher, audit),
    update: new UpdateClassroomAccountUseCase(accounts, cipher, audit),
    retire: new RetireClassroomAccountUseCase(accounts, audit),
    reveal: new RevealClassroomAccountPasswordUseCase(accounts, cipher, audit),
  };
}

describe("AesGcmCredentialCipher", () => {
  it("opens what it sealed, and seals the same password differently each time", () => {
    const cipher = new AesGcmCredentialCipher(SECRET);
    const first = cipher.seal("Clave 2026!");
    expect(first.startsWith("v1:")).toBe(true);
    expect(first).not.toContain("Clave");
    expect(cipher.seal("Clave 2026!")).not.toBe(first);
    expect(cipher.open(first)).toBe("Clave 2026!");
  });

  it("refuses, closed, a value sealed under another secret or damaged", () => {
    const sealed = new AesGcmCredentialCipher("b".repeat(40)).seal("x");
    const cipher = new AesGcmCredentialCipher(SECRET);
    expect(() => cipher.open(sealed)).toThrow(ClassroomCredentialsUnavailableError);
    expect(() => cipher.open("v1:AAAA")).toThrow(ClassroomCredentialsUnavailableError);
    expect(() => cipher.open("plain")).toThrow(ClassroomCredentialsUnavailableError);
  });
});

describe("Classroom account usecases", () => {
  it("stores the e-mail normalized and the password sealed, and audits no value", async () => {
    const { create, accounts, cipher, audit } = setup();

    const account = await create.run({ actorId: "staff", account: { email: " Aulas.Ooc01@Gmail.com ", password: "s3creta" } });

    const stored = accounts.rows.get(account.id)!;
    expect(stored.email).toBe("aulas.ooc01@gmail.com");
    expect(stored.passwordCiphertext).not.toContain("s3creta");
    expect(cipher.open(stored.passwordCiphertext)).toBe("s3creta");
    expect(JSON.stringify(audit.appended)).not.toContain("s3creta");
    expect(audit.appended).toEqual([expect.objectContaining({ action: "classroom_account.created" })]);
  });

  it("refuses an empty password and a bad e-mail, naming the fields", async () => {
    const { create } = setup();
    const error = await create.run({ actorId: "staff", account: { email: "nope", password: "   " } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidFieldsError);
    expect((error as InvalidFieldsError).fields.map((field) => field.path).sort()).toEqual([
      "classroomAccount.email",
      "classroomAccount.password",
    ]);
  });

  it("a new password clears the 'change it' flag a departure raised", async () => {
    const { create, update, accounts, audit } = setup();
    const account = await create.run({ actorId: "staff", account: { email: "aulas.ooc02@gmail.com", password: "old" } });
    const stored = accounts.rows.get(account.id)!;
    stored.passwordChangedAt = new Date(Date.now() - 10_000);
    stored.releasedAt = new Date(Date.now() - 5_000);
    expect(stored.passwordChangeDue).toBe(true);

    await update.run({ actorId: "staff", id: account.id, changes: { password: "new" } });

    expect(accounts.rows.get(account.id)!.passwordChangeDue).toBe(false);
    expect(audit.appended.at(-1)).toMatchObject({ action: "classroom_account.updated", metadata: { fields: ["password"] } });
  });

  it("writes nothing when the e-mail is the same and no password came", async () => {
    const { create, update, audit } = setup();
    const account = await create.run({ actorId: "staff", account: { email: "aulas.ooc02@gmail.com", password: "x" } });
    await update.run({ actorId: "staff", id: account.id, changes: { email: "AULAS.OOC02@gmail.com" } });
    expect(audit.appended).toHaveLength(1);
  });

  it("refuses to retire an account a teacher still uses", async () => {
    const { create, retire, accounts } = setup();
    const account = await create.run({ actorId: "staff", account: { email: "aulas.ooc02@gmail.com", password: "x" } });
    accounts.teachersOn.set(account.id, 1);
    await expect(retire.run({ actorId: "staff", id: account.id })).rejects.toBeInstanceOf(ClassroomAccountInUseError);
  });

  it("audits every password reveal, without the password", async () => {
    const { create, reveal, audit } = setup();
    const account = await create.run({ actorId: "staff", account: { email: "aulas.ooc02@gmail.com", password: "pw-123" } });

    const shown = await reveal.run({ actorId: "staff-2", id: account.id });

    expect(shown).toMatchObject({ email: "aulas.ooc02@gmail.com", password: "pw-123" });
    expect(audit.appended.at(-1)).toMatchObject({
      action: "classroom_account.password_viewed",
      actorId: "staff-2",
      targetId: account.id,
      metadata: { by: "staff" },
    });
    expect(JSON.stringify(audit.appended)).not.toContain("pw-123");
  });
});

describe("GetOwnClassroomAccessUseCase", () => {
  async function withAccount() {
    const base = setup();
    const account = await base.create.run({ actorId: "staff", account: { email: "aulas.ooc02@gmail.com", password: "pw" } });
    return { ...base, account };
  }

  it("shows the teacher the account their own file points at", async () => {
    const { accounts, cipher, audit, account } = await withAccount();
    const teachers = new FakeTeacherRepository(teacher("usr_t", account.id));
    const own = new GetOwnClassroomAccessUseCase(teachers, accounts, cipher, audit);

    await expect(own.run({ userId: "usr_t" })).resolves.toMatchObject({ email: "aulas.ooc02@gmail.com", password: "pw" });
    expect(audit.appended.at(-1)).toMatchObject({ action: "classroom_account.password_viewed", metadata: { by: "teacher" } });
  });

  it("sees nothing without a file, without an account, or off the roster", async () => {
    const { accounts, cipher, audit, account } = await withAccount();
    const inactive = teacher("usr_gone", account.id);
    inactive.status = "inactive";
    const teachers = new FakeTeacherRepository(teacher("usr_none", null), inactive);
    const own = new GetOwnClassroomAccessUseCase(teachers, accounts, cipher, audit);

    await expect(own.run({ userId: "usr_nobody" })).resolves.toBeNull();
    await expect(own.run({ userId: "usr_none" })).resolves.toBeNull();
    await expect(own.run({ userId: "usr_gone" })).resolves.toBeNull();
  });
});

describe("assigning a Classroom account on the teacher file", () => {
  it("reads the cap from the settings and hands it to the repository", async () => {
    const file = teacher(null, null);
    const teachers = new FakeTeacherRepository(file);
    const settings = new FakePlatformSettings();
    await settings.update({ changes: { classroomAccountMaxTeachers: 3 }, actorId: "x", audit: [] });
    const writes: unknown[] = [];
    const update = teachers.update.bind(teachers);
    teachers.update = async (entity: Teacher, classroom?: ClassroomAccountWrite) => {
      writes.push(classroom);
      return update(entity);
    };
    const usecase = new UpdateTeacherUseCase(teachers, new FakeAuditLogRepository(), settings);

    await usecase.run({
      actorId: "staff",
      teacherId: file.id,
      teacher: {
        firstName: "Ana",
        lastName: "Quispe",
        personalEmail: "ana@example.com",
        languages: [],
        classroomAccountId: "0196a000-0000-7000-8000-000000000001",
      },
    });

    expect(writes).toEqual([{ maxTeachers: 3 }]);
  });

  it("refuses to give an account to a teacher off the roster", async () => {
    const file = teacher(null, null);
    file.status = "inactive";
    const usecase = new UpdateTeacherUseCase(
      new FakeTeacherRepository(file),
      new FakeAuditLogRepository(),
      new FakePlatformSettings(),
    );

    await expect(
      usecase.run({
        actorId: "staff",
        teacherId: file.id,
        teacher: {
          firstName: "Ana",
          lastName: "Quispe",
          personalEmail: "ana@example.com",
          languages: [],
          classroomAccountId: "0196a000-0000-7000-8000-000000000001",
        },
      }),
    ).rejects.toBeInstanceOf(ClassroomAccountTeacherInactiveError);
  });
});
