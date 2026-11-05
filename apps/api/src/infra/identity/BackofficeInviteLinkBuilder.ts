import type { IStaffInviteLinkBuilder, Locale } from "@ooc/domain";
import { APP_LOCALE_PREFIX } from "./BackofficePasswordResetLinkBuilder.js";

/**
 * Builds the same URL the team screen copies for an invite
 * (`/[locale]/backoffice/invite/[token]`), on the panel's public origin.
 */
export class BackofficeInviteLinkBuilder implements IStaffInviteLinkBuilder {
  constructor(private readonly backofficeOrigin: string) {}

  build(token: string, locale: Locale): string {
    return `${this.backofficeOrigin}${APP_LOCALE_PREFIX[locale]}/backoffice/invite/${encodeURIComponent(token)}`;
  }
}
