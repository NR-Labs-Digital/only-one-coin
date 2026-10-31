import { createHash } from "node:crypto";
import { LocaleSchema, type EmailTemplateKey } from "@ooc/domain";
import { LOCALE_CATALOGS } from "./renderEmail.js";

/**
 * A short fingerprint of what a template says, in every locale (OOC-88). The
 * templates are JSON in the repository with no version number of their own,
 * so the version is derived from the content: the same words give the same
 * value, and any change — one locale, one comma, or the shared layout every
 * e-mail is wrapped in — gives a new one.
 *
 * It answers "is this the wording I reviewed?", not "which release": the
 * order of versions is the Git history's, not this value's.
 */
export function templateVersion(templateKey: EmailTemplateKey): string {
  const content = LocaleSchema.options.map((locale) => ({
    locale,
    layout: LOCALE_CATALOGS[locale].layout,
    template: LOCALE_CATALOGS[locale].templates[templateKey],
  }));
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 8);
}
