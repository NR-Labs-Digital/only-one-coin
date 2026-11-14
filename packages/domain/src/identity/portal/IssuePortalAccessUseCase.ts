import { DEFAULT_LOCALE } from "../../notification/EmailNotification.js";
import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";
import type { IAuditLogRepository } from "../ports/IAuditLogRepository.js";
import { newPortalToken, type PortalAccessOutcome } from "./PortalAccess.js";
import { portalCredentialsEmail, portalPasswordResetEmail } from "./portalEmails.js";
import { guardianProvisioning } from "./guardianAccess.js";
import type { IPortalAccessRepository, IPortalLinkBuilder } from "./ports.js";

export type IssuePortalAccessOutcome = PortalAccessOutcome | "activation_resent" | "reset_sent";

export interface IssuePortalAccessInput {
  actorId: string;
  studentId: string;
}

/**
 * "Send portal access" on the student file — for whoever was approved before
 * accounts existed, and for the e-mail conflict once staff fixed the address.
 * Only for a student with a confirmed seat: the portal is for enrolled
 * students (CLAUDE.md §1, OOC-55). No account → create it; account without a
 * password → its activation again; active account → a reset link.
 */
export class IssuePortalAccessUseCase extends BaseUseCase<IssuePortalAccessInput, { outcome: IssuePortalAccessOutcome }> {
  constructor(
    private readonly portalAccess: IPortalAccessRepository,
    private readonly links: IPortalLinkBuilder,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: IssuePortalAccessInput): Promise<{ outcome: IssuePortalAccessOutcome }> {
    if (!(await this.portalAccess.hasConfirmedEnrollment(input.studentId))) {
      throw new UnableToProcessEntryError({
        reason: "portal_access.no_confirmed_enrollment",
        message: "Portal access needs a confirmed enrollment.",
      });
    }

    const now = new Date();
    let account = await this.portalAccess.findAccountByStudent(input.studentId);
    if (!account) {
      const activation = newPortalToken("activation", now);
      const provisioned = await this.portalAccess.provision({
        studentId: input.studentId,
        actorId: input.actorId,
        activation,
        at: now,
        notify: (created, tokenId) => [
          portalCredentialsEmail(created, this.links.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
        ],
        guardian: guardianProvisioning(this.links, now),
      });
      // A duplicate file just linked to an existing account: staff asked for
      // an e-mail, so it goes to that account below.
      if (provisioned !== "linked_existing") return this.done(input, provisioned, now);
      account = await this.portalAccess.findAccountByStudent(input.studentId);
      if (!account) return this.done(input, provisioned, now);
    }

    const target = account;
    const purpose = target.hasPassword ? "reset" : "activation";
    const token = newPortalToken(purpose, now);
    const url = this.links.access(token.token, DEFAULT_LOCALE);
    await this.portalAccess.issueToken({
      userId: target.userId,
      token,
      cooldownSince: null,
      notify: (tokenId) => [
        purpose === "reset"
          ? portalPasswordResetEmail(target, url, tokenId, DEFAULT_LOCALE)
          : portalCredentialsEmail(target, url, tokenId, DEFAULT_LOCALE),
      ],
    });
    return this.done(input, purpose === "reset" ? "reset_sent" : "activation_resent", now);
  }

  private async done(input: IssuePortalAccessInput, outcome: IssuePortalAccessOutcome, at: Date) {
    await this.auditLog.append({ actorId: input.actorId, action: "portal_access.issued", targetId: input.studentId, metadata: { outcome }, at });
    return { outcome };
  }
}
