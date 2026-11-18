import { DEFAULT_LOCALE } from "../../notification/EmailNotification.js";
import { BaseUseCase } from "../../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../../shared/base/errors/UnableToProcessEntryError.js";
import type { IAuditLogRepository } from "../ports/IAuditLogRepository.js";
import { newPortalToken, type PortalAccessOutcome, type PortalAccount } from "./PortalAccess.js";
import { portalCredentialsEmail, portalPasswordResetEmail } from "./portalEmails.js";
import { guardianProvisioning } from "./guardianAccess.js";
import type { IPortalAccessRepository, IPortalLinkBuilder } from "./ports.js";

export type IssuePortalAccessOutcome = PortalAccessOutcome | "activation_resent" | "reset_sent";

/**
 * What the button did for the guardian (OOC-72), when it did anything:
 * - `created` — an account in the guardian's address, with its activation;
 * - `linked` — the guardian's existing account now reaches the file;
 * - `activation_resent` — the guardian's account had no password yet: its
 *   activation went out again;
 * - `active` — the guardian already has a password: nothing sent, the
 *   consent is waiting for them at the next sign-in;
 * - `conflict` — a staff or blocked account has the guardian's address.
 */
export type IssueGuardianAccessOutcome = "created" | "linked" | "activation_resent" | "active" | "conflict";

export interface IssuePortalAccessInput {
  actorId: string;
  studentId: string;
}

export interface IssuePortalAccessOutput {
  outcome: IssuePortalAccessOutcome;
  /** Null when the guardian's door was not part of it. */
  guardian: IssueGuardianAccessOutcome | null;
}

/**
 * "Send portal access" on the student file — for whoever was approved before
 * accounts existed, and for the e-mail conflict once staff fixed the address.
 * Only for a student with a confirmed seat: the portal is for enrolled
 * students (CLAUDE.md §1, OOC-55). No account → create it; account without a
 * password → its activation again; active account → a reset link.
 *
 * The guardian's door (OOC-147) opens with the student's own account, as on
 * an approval. On a file whose account already exists it opens only while a
 * minor's consent is pending (OOC-72): the guardian accepts the consent in
 * the portal, so a file without the guardian's account would stay pending
 * forever. This is the one exception to "files that had an account before
 * OOC-147 get no guardian account" (decision of 18/11/2026).
 */
export class IssuePortalAccessUseCase extends BaseUseCase<IssuePortalAccessInput, IssuePortalAccessOutput> {
  constructor(
    private readonly portalAccess: IPortalAccessRepository,
    private readonly links: IPortalLinkBuilder,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: IssuePortalAccessInput): Promise<IssuePortalAccessOutput> {
    if (!(await this.portalAccess.hasConfirmedEnrollment(input.studentId))) {
      throw new UnableToProcessEntryError({
        reason: "portal_access.no_confirmed_enrollment",
        message: "Portal access needs a confirmed enrollment.",
      });
    }

    const now = new Date();
    const studentOutcome = await this.studentAccess(input, now);
    const guardianDue = studentOutcome.opened || (await this.portalAccess.guardianConsentPending(input.studentId));
    const guardian = guardianDue ? await this.guardianAccess(input, now) : null;
    return this.done(input, studentOutcome.outcome, guardian, now);
  }

  /** The student's own account; `opened` when this call created or joined it. */
  private async studentAccess(input: IssuePortalAccessInput, now: Date): Promise<{ outcome: IssuePortalAccessOutcome; opened: boolean }> {
    let account = await this.portalAccess.findAccountByStudent(input.studentId);
    if (!account) {
      const activation = newPortalToken("activation", now);
      // The guardian's half runs after, on its own (`guardianAccess`), so the
      // button can say what it did for the guardian.
      const provisioned = await this.portalAccess.provision({
        studentId: input.studentId,
        actorId: input.actorId,
        activation,
        at: now,
        notify: (created, tokenId) => [
          portalCredentialsEmail(created, this.links.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
        ],
      });
      const opened = provisioned !== "already_linked";
      // A duplicate file just linked to an existing account: staff asked for
      // an e-mail, so it goes to that account below.
      if (provisioned !== "linked_existing") return { outcome: provisioned, opened };
      account = await this.portalAccess.findAccountByStudent(input.studentId);
      if (!account) return { outcome: provisioned, opened };
    }

    return { outcome: await this.resend(account, true), opened: false };
  }

  private async guardianAccess(input: IssuePortalAccessInput, now: Date): Promise<IssueGuardianAccessOutcome | null> {
    const door = await this.portalAccess.openGuardianAccess({
      studentId: input.studentId,
      actorId: input.actorId,
      at: now,
      guardian: guardianProvisioning(this.links, now),
    });
    switch (door.outcome) {
      case "not_applicable":
        return null;
      case "created":
      case "conflict":
        return door.outcome;
      case "linked":
      case "already_linked": {
        if (door.account && !door.account.hasPassword) {
          await this.resend(door.account, false);
          return "activation_resent";
        }
        return door.outcome === "linked" ? "linked" : "active";
      }
    }
  }

  /**
   * A fresh link to an existing account: its activation while it has no
   * password, otherwise a reset — only when `resetWhenActive` (staff asked
   * for the student's access; the guardian's door never resets a password).
   */
  private async resend(target: PortalAccount, resetWhenActive: boolean): Promise<"activation_resent" | "reset_sent"> {
    const purpose = target.hasPassword && resetWhenActive ? "reset" : "activation";
    const token = newPortalToken(purpose, new Date());
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
    return purpose === "reset" ? "reset_sent" : "activation_resent";
  }

  private async done(
    input: IssuePortalAccessInput,
    outcome: IssuePortalAccessOutcome,
    guardian: IssueGuardianAccessOutcome | null,
    at: Date,
  ): Promise<IssuePortalAccessOutput> {
    await this.auditLog.append({
      actorId: input.actorId,
      action: "portal_access.issued",
      targetId: input.studentId,
      metadata: guardian ? { outcome, guardian } : { outcome },
      at,
    });
    return { outcome, guardian };
  }
}
