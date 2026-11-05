import type { Locale } from "../../notification/EmailNotification.js";

/**
 * Where an invite token becomes a URL somebody can click. The panel's public
 * origin and its locale routing belong to the deploy, not the domain.
 */
export interface IStaffInviteLinkBuilder {
  build(token: string, locale: Locale): string;
}
