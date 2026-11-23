import type { IStaffInviteLinkBuilder, Locale, Role } from "@ooc/domain";
import { APP_LOCALE_PREFIX } from "./BackofficePasswordResetLinkBuilder.js";
import { type StaffDoorOrigins, staffDoorOrigin } from "./StaffDoorOrigins.js";

/**
 * Builds the same URL the team screen copies for an invite
 * (`/[locale]/backoffice/invite/[token]`), on the public origin of the door
 * the cargo uses — the teacher domain serves this screen too.
 */
export class BackofficeInviteLinkBuilder implements IStaffInviteLinkBuilder {
  constructor(private readonly origins: StaffDoorOrigins) {}

  build(token: string, locale: Locale, role: Role): string {
    return `${staffDoorOrigin(this.origins, role)}${APP_LOCALE_PREFIX[locale]}/backoffice/invite/${encodeURIComponent(token)}`;
  }
}
