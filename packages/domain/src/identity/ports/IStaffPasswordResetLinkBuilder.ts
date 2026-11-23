import type { Locale } from "../../notification/EmailNotification.js";
import type { Role } from "../Role.js";

/**
 * Where a password-reset token becomes a URL somebody can click. The panel's
 * public origin and its locale routing belong to the deploy, not the domain
 * (CLAUDE.md §6: no hardcoded host). The cargo picks the door, as for an
 * invite (IStaffInviteLinkBuilder).
 */
export interface IStaffPasswordResetLinkBuilder {
  build(token: string, locale: Locale, role: Role): string;
}
