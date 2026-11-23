import type { IStaffPasswordResetLinkBuilder, Locale, Role } from "@ooc/domain";
import { type StaffDoorOrigins, staffDoorOrigin } from "./StaffDoorOrigins.js";

/**
 * apps/app routes on short locale codes with the default one unprefixed
 * (`apps/app/src/i18n/routing.ts`: es, en, pt — `localePrefix: "as-needed"`).
 */
export const APP_LOCALE_PREFIX: Record<Locale, string> = {
  "es-PE": "",
  "pt-BR": "/pt",
  en: "/en",
};

/**
 * Builds the same URL the team screen copies for an admin-generated link
 * (`/[locale]/backoffice/reset-password/[token]`), on the public origin of
 * the door the cargo uses. The `/backoffice` segment stays even on
 * backoffice.* and teacher.* — the app's middleware serves this screen as is
 * on both.
 */
export class BackofficePasswordResetLinkBuilder implements IStaffPasswordResetLinkBuilder {
  constructor(private readonly origins: StaffDoorOrigins) {}

  build(token: string, locale: Locale, role: Role): string {
    return `${staffDoorOrigin(this.origins, role)}${APP_LOCALE_PREFIX[locale]}/backoffice/reset-password/${encodeURIComponent(token)}`;
  }
}
