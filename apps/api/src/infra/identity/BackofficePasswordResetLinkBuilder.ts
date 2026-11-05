import type { IStaffPasswordResetLinkBuilder, Locale } from "@ooc/domain";

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
 * (`/[locale]/backoffice/reset-password/[token]`), on the panel's public
 * origin. The `/backoffice` segment stays even on backoffice.* — the app's
 * middleware leaves a path that already carries it alone.
 */
export class BackofficePasswordResetLinkBuilder implements IStaffPasswordResetLinkBuilder {
  constructor(private readonly backofficeOrigin: string) {}

  build(token: string, locale: Locale): string {
    return `${this.backofficeOrigin}${APP_LOCALE_PREFIX[locale]}/backoffice/reset-password/${encodeURIComponent(token)}`;
  }
}
