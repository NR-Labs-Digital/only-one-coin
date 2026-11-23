import { randomBytes } from "node:crypto";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { EmailNotification, Locale } from "../notification/EmailNotification.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffPasswordResetLinkBuilder } from "./ports/IStaffPasswordResetLinkBuilder.js";
import type { IStaffPasswordResetRepository } from "./ports/IStaffPasswordResetRepository.js";
import type { IStaffUserLookup } from "./ports/IStaffUserLookup.js";

/**
 * How long a link sent by e-mail stays valid. Shorter than the 24h of the
 * link an admin generates (`CreateStaffPasswordResetUseCase`): this one is
 * asked for by anybody who types the address, and it lands in a mailbox, not
 * in the hands of somebody who already checked who is asking. The e-mail copy
 * says "one hour" (packages/notifications/src/locales) — keep both in step.
 */
export const SELF_SERVICE_RESET_TTL_MINUTES = 60;

/**
 * At most one e-mail per account in this window, however many times the
 * button is pressed — what keeps the route from being a way to flood a
 * colleague's inbox while there is no rate limit yet (docs/ROADMAP.md
 * Sessão 25).
 */
export const SELF_SERVICE_RESET_COOLDOWN_SECONDS = 60;

export interface RequestStaffPasswordResetInput {
  email: string;
  /** The language of the login screen the request came from. */
  locale: Locale;
}

/**
 * "Forgot my password" from the panel's login (OOC-30): e-mails a one-time
 * link to the account owner, who completes it through the same
 * `CompleteStaffPasswordResetUseCase` an admin-generated link goes through.
 *
 * Returns nothing, on every path, on purpose (CLAUDE.md §8, anti-enumeration):
 * an unknown address, a student's address, a removed account and a request
 * inside the cooldown all end exactly like a link that went out. The only
 * trace of the difference is server-side — an `audit_log` row when a link was
 * actually issued.
 *
 * A link already pending for the account — one an admin generated, or one
 * from a previous request — is reused and its expiry extended rather than
 * replaced: the admin may have already sent theirs by hand, and the table
 * allows one pending reset per user anyway.
 */
export class RequestStaffPasswordResetUseCase extends BaseUseCase<RequestStaffPasswordResetInput, void> {
  constructor(
    private readonly staffUserLookup: IStaffUserLookup,
    private readonly staffPasswordResetRepository: IStaffPasswordResetRepository,
    private readonly linkBuilder: IStaffPasswordResetLinkBuilder,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RequestStaffPasswordResetInput): Promise<void> {
    const user = await this.staffUserLookup.findResettableStaffByEmail(input.email.trim().toLowerCase());
    if (!user) return;

    const now = new Date();
    const reset = await this.staffPasswordResetRepository.issueSelfService(
      {
        userId: user.id,
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(now.getTime() + SELF_SERVICE_RESET_TTL_MINUTES * 60_000),
        requestedAt: now,
        cooldownSince: new Date(now.getTime() - SELF_SERVICE_RESET_COOLDOWN_SECONDS * 1000),
      },
      (issued): EmailNotification[] => [
        {
          templateKey: "staff_password_reset",
          to: user.email,
          locale: input.locale,
          vars: {
            recipientName: user.name,
            resetUrl: this.linkBuilder.build(issued.token, input.locale, user.role),
          },
          // Same reset, new request, new e-mail: the request instant is what
          // tells two sends of the same link apart. A retry of the very same
          // request still collapses into one.
          dedupeKey: `staff_password_reset:${issued.id}:${now.getTime()}`,
        },
      ],
    );
    if (!reset) return;

    await this.auditLogRepository.append({
      actorId: user.id,
      action: "staff.password_reset_requested",
      targetId: user.id,
      metadata: {},
      at: now,
    });
  }
}
