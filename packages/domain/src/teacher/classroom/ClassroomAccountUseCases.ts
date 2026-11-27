import type { IAuditLogRepository } from "../../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import { ClassroomAccountInUseError, ClassroomAccountNotFoundError } from "../errors.js";
import type { ITeacherRepository } from "../TeacherRepository.js";
import {
  ClassroomAccount,
  type ClassroomAccountChangesDTO,
  type ClassroomAccountField,
  type ClassroomAccountFieldsDTO,
} from "./ClassroomAccount.js";
import type { IClassroomAccountRepository, ICredentialCipher } from "./ports.js";

/**
 * The shared Classroom logins (OOC-196). Every audit line names the fields,
 * never a value — and never the password, sealed or not (CLAUDE.md §8).
 */

export interface CreateClassroomAccountInput {
  actorId: string;
  account: ClassroomAccountFieldsDTO;
}

export class CreateClassroomAccountUseCase extends BaseUseCase<CreateClassroomAccountInput, ClassroomAccount> {
  constructor(
    private readonly accounts: IClassroomAccountRepository,
    private readonly cipher: ICredentialCipher,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateClassroomAccountInput): Promise<ClassroomAccount> {
    const fields = ClassroomAccount.parse(input.account);
    const account = ClassroomAccount.create({ email: fields.email, passwordCiphertext: this.cipher.seal(fields.password) });
    await this.accounts.create(account);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "classroom_account.created",
      targetId: account.id,
      metadata: {},
      at: account.createdAt,
    });
    return account;
  }
}

export interface UpdateClassroomAccountInput {
  actorId: string;
  id: string;
  changes: ClassroomAccountChangesDTO;
}

export class UpdateClassroomAccountUseCase extends BaseUseCase<UpdateClassroomAccountInput, ClassroomAccount> {
  constructor(
    private readonly accounts: IClassroomAccountRepository,
    private readonly cipher: ICredentialCipher,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateClassroomAccountInput): Promise<ClassroomAccount> {
    const account = await this.accounts.findById(input.id);
    if (!account) throw new ClassroomAccountNotFoundError();

    const changes = ClassroomAccount.parseChanges(input.changes);
    const fields: ClassroomAccountField[] = [];
    if (changes.email !== undefined && account.changeEmail(changes.email)) fields.push("email");
    if (changes.password !== undefined) {
      account.changePassword(this.cipher.seal(changes.password));
      fields.push("password");
    }
    if (fields.length === 0) return account;

    await this.accounts.update(account);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "classroom_account.updated",
      targetId: account.id,
      metadata: { fields },
      at: account.updatedAt,
    });
    return account;
  }
}

export interface RetireClassroomAccountInput {
  actorId: string;
  id: string;
}

/** Refused while teachers still use the account: they move to another one first. */
export class RetireClassroomAccountUseCase extends BaseUseCase<RetireClassroomAccountInput, void> {
  constructor(
    private readonly accounts: IClassroomAccountRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireClassroomAccountInput): Promise<void> {
    const account = await this.accounts.findById(input.id);
    if (!account) throw new ClassroomAccountNotFoundError();
    if ((await this.accounts.countTeachers(account.id)) > 0) throw new ClassroomAccountInUseError();

    account.softDelete();
    await this.accounts.retire(account);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "classroom_account.retired",
      targetId: account.id,
      metadata: {},
      at: account.deletedAt ?? new Date(),
    });
  }
}

export interface ClassroomCredentials {
  accountId: string;
  email: string;
  password: string;
  passwordChangedAt: Date;
}

export interface RevealClassroomAccountPasswordInput {
  actorId: string;
  id: string;
}

/**
 * Shows the password to the staff who manage the accounts. Every reveal goes
 * to the audit log, before the password leaves.
 */
export class RevealClassroomAccountPasswordUseCase extends BaseUseCase<
  RevealClassroomAccountPasswordInput,
  ClassroomCredentials
> {
  constructor(
    private readonly accounts: IClassroomAccountRepository,
    private readonly cipher: ICredentialCipher,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RevealClassroomAccountPasswordInput): Promise<ClassroomCredentials> {
    const account = await this.accounts.findById(input.id);
    if (!account) throw new ClassroomAccountNotFoundError();
    const password = this.cipher.open(account.passwordCiphertext);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "classroom_account.password_viewed",
      targetId: account.id,
      metadata: { by: "staff" },
      at: new Date(),
    });
    return { accountId: account.id, email: account.email, password, passwordChangedAt: account.passwordChangedAt };
  }
}

export interface GetOwnClassroomAccessInput {
  /** The signed-in teacher account ("user".id). */
  userId: string;
}

/**
 * "Ver mis accesos de Classroom" (OOC-196): the account the teacher's own file
 * points at, with its password. Resolved from the session, never from an id
 * the client sends; an account with no file, or a file with no Classroom
 * account, sees nothing (CLAUDE.md §8, "Id de escopo nulo não é um id").
 */
export class GetOwnClassroomAccessUseCase extends BaseUseCase<GetOwnClassroomAccessInput, ClassroomCredentials | null> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly accounts: IClassroomAccountRepository,
    private readonly cipher: ICredentialCipher,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: GetOwnClassroomAccessInput): Promise<ClassroomCredentials | null> {
    const teacher = await this.teachers.findByUserId(input.userId);
    if (!teacher || !teacher.isActive || teacher.classroomAccountId === null) return null;

    const account = await this.accounts.findById(teacher.classroomAccountId);
    if (!account) return null;
    const password = this.cipher.open(account.passwordCiphertext);

    await this.auditLog.append({
      actorId: input.userId,
      action: "classroom_account.password_viewed",
      targetId: account.id,
      metadata: { by: "teacher" },
      at: new Date(),
    });
    return { accountId: account.id, email: account.email, password, passwordChangedAt: account.passwordChangedAt };
  }
}
