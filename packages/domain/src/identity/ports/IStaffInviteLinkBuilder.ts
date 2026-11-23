import type { Locale } from "../../notification/EmailNotification.js";
import type { Role } from "../Role.js";

/**
 * Where an invite token becomes a URL somebody can click. The panel's public
 * origin and its locale routing belong to the deploy, not the domain. The
 * cargo picks the door: a teacher's link opens on the teacher portal's domain,
 * so the session the invite starts is the one that portal reads.
 */
export interface IStaffInviteLinkBuilder {
  build(token: string, locale: Locale, role: Role): string;
}
