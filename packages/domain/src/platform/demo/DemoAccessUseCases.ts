import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";
import { isOwnerEmail } from "../../identity/Role.js";
import type { IAuditLogRepository } from "../../identity/ports/IAuditLogRepository.js";
import type { CreateStaffInviteUseCase } from "../../identity/CreateStaffInviteUseCase.js";
import type { IssuePortalAccessUseCase } from "../../identity/portal/IssuePortalAccessUseCase.js";
import { gmailUsernameIssue, isGmail, normalizeEmail } from "../../student/fields.js";
import { NotAPlatformOwnerError } from "../errors.js";
import type { DemoAccessKind } from "./DemoAccess.js";
import { DemoAccessNotFoundError, DemoEmailInUseError, DemoStudentEmailNotGmailError } from "./errors.js";
import type { IDemoAccessRepository } from "./IDemoAccessRepository.js";

export interface CreateDemoAccessInput {
  actorId: string;
  actorEmail: string;
  /** What the owner's own cargo lets them do — the teacher invite still refuses to hand out more. */
  actorPermissions: ReadonlySet<string>;
  kind: DemoAccessKind;
  email: string;
  firstName: string;
  lastName: string;
  courseId: string;
}

export interface CreateDemoAccessOutput {
  accessId: string;
}

/**
 * Opens a demo access (28/11/2026): the platform owners' alone, by e-mail
 * domain, never by cargo — the route is `.owners()` and this checks it again,
 * like the backups.
 *
 * The demo rows land first, in one transaction; then the account goes through
 * the door that already exists — the portal access an approval opens
 * (set-password link) for a student, the teacher invite tied to the file for
 * a teacher. The two steps are not atomic: if the second fails, the demo rows
 * stay (hidden, like every demo row) and the access is listed as not
 * activated, ready to revoke.
 *
 * The demo enrollment is born confirmed without a payment — the one exception
 * to "a seat is confirmed only by a person approving a payment" (CLAUDE.md §1),
 * held to the demo class group, which never sells.
 */
export class CreateDemoAccessUseCase extends BaseUseCase<CreateDemoAccessInput, CreateDemoAccessOutput> {
  constructor(
    private readonly demos: IDemoAccessRepository,
    private readonly issuePortalAccess: IssuePortalAccessUseCase,
    private readonly createStaffInvite: CreateStaffInviteUseCase,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateDemoAccessInput): Promise<CreateDemoAccessOutput> {
    if (!isOwnerEmail(input.actorEmail)) throw new NotAPlatformOwnerError();

    const email = normalizeEmail(input.email);
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UnableToProcessEntryError({ reason: "demo_access.invalid_fields", message: "Name and a valid e-mail are required." });
    }
    // The student's portal account is the Gmail Classroom reaches (CLAUDE.md §1).
    if (input.kind === "student" && (!isGmail(email) || gmailUsernameIssue(email) !== null)) {
      throw new DemoStudentEmailNotGmailError();
    }
    if (await this.demos.emailInUse(email)) throw new DemoEmailInUseError();

    const at = new Date();
    const kitInput = { courseId: input.courseId, firstName, lastName, email, actorId: input.actorId, at };

    if (input.kind === "student") {
      const kit = await this.demos.createStudentKit(kitInput);
      await this.audit(input, kit.accessId, at);
      await this.issuePortalAccess.run({ actorId: input.actorId, studentId: kit.ownerId });
      return { accessId: kit.accessId };
    }

    const kit = await this.demos.createTeacherKit(kitInput);
    await this.audit(input, kit.accessId, at);
    await this.createStaffInvite.run({
      actorId: input.actorId,
      email,
      firstName,
      lastName,
      role: "teacher",
      teacherId: kit.ownerId,
      actorPermissions: input.actorPermissions,
    });
    return { accessId: kit.accessId };
  }

  /** Never the address: audit_log keeps what happened, not personal data (CLAUDE.md §8). */
  private async audit(input: CreateDemoAccessInput, accessId: string, at: Date): Promise<void> {
    await this.auditLog.append({
      actorId: input.actorId,
      action: "demo_access.created",
      targetId: accessId,
      metadata: { kind: input.kind, courseId: input.courseId },
      at,
    });
  }
}

export interface RevokeDemoAccessInput {
  actorId: string;
  actorEmail: string;
  accessId: string;
}

/** Closes a demo access for good: the account stops opening, the class group is retired. */
export class RevokeDemoAccessUseCase extends BaseUseCase<RevokeDemoAccessInput, void> {
  constructor(
    private readonly demos: IDemoAccessRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RevokeDemoAccessInput): Promise<void> {
    if (!isOwnerEmail(input.actorEmail)) throw new NotAPlatformOwnerError();
    const at = new Date();
    const revoked = await this.demos.revoke(input.accessId, input.actorId, at);
    if (!revoked) throw new DemoAccessNotFoundError();
    await this.auditLog.append({
      actorId: input.actorId,
      action: "demo_access.revoked",
      targetId: input.accessId,
      metadata: { kind: revoked.kind },
      at,
    });
  }
}
