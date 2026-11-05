import type { EmailTemplateKey, EmailTemplateVars, Locale } from "@ooc/domain";
import en from "../locales/en.json" with { type: "json" };
import esPE from "../locales/es-PE.json" with { type: "json" };
import ptBR from "../locales/pt-BR.json" with { type: "json" };
import type { OutgoingEmail } from "../NotificationProvider.js";

interface TemplateCopy {
  subject: string;
  /** The line mail clients show next to the subject, before opening. */
  preheader: string;
  paragraphs: string[];
  /** Button label — only on templates listed in ACTION_URL_VAR. */
  action?: string;
}

export interface LocaleCatalog {
  layout: { greeting: string; signature: string; footer: string };
  templates: Record<EmailTemplateKey, TemplateCopy>;
}

/**
 * Every word an e-mail says lives in these files, one per locale, same keys
 * in all three (CLAUDE.md §4) — a fourth language is one more file here. The
 * annotation is what makes a template missing from a locale a compile error.
 */
export const LOCALE_CATALOGS: Record<Locale, LocaleCatalog> = {
  "es-PE": esPE,
  "pt-BR": ptBR,
  en,
};

/** Which var holds the URL behind a template's button. */
const ACTION_URL_VAR: Partial<Record<EmailTemplateKey, string>> = {
  portal_credentials: "accessUrl",
  portal_password_reset: "resetUrl",
  staff_invite: "accessUrl",
  staff_password_reset: "resetUrl",
};

/** Intl wants a region to pick date/number conventions; `en` alone is fine. */
const INTL_LOCALE: Record<Locale, string> = {
  "es-PE": "es-PE",
  "pt-BR": "pt-BR",
  en: "en-US",
};

// Stored in UTC, rendered in Lima (CLAUDE.md §6) — the one place an e-mail
// turns a timestamp into a date somebody reads.
const TIME_ZONE = "America/Lima";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/**
 * Turns the raw vars into the strings a placeholder shows. Dates arrive as
 * ISO strings and money as cents (they are JSON in `outbox.vars`); here they
 * become "15 de octubre de 2026" and "S/ 250.00" in the reader's locale.
 */
function placeholderValues(
  vars: EmailTemplateVars[EmailTemplateKey],
  locale: Locale,
): Record<string, string> {
  const intlLocale = INTL_LOCALE[locale];
  const values: Record<string, string> = {};

  for (const [name, value] of Object.entries(vars)) {
    if (name === "amountCents" && typeof value === "number") {
      values.amount = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "PEN" }).format(value / 100);
    } else if (name === "startsOn" && typeof value === "string") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new TemplateRenderError(`Var "${name}" is not a date`);
      values.startsOn = new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeZone: TIME_ZONE }).format(date);
    } else {
      values[name] = String(value);
    }
  }

  return values;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fills `{name}` placeholders. A placeholder with no value is a template
 * bug, not something to send half-written. */
function interpolate(copy: string, values: Record<string, string>): string {
  return copy.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new TemplateRenderError(`Missing value for placeholder "{${name}}"`);
    return value;
  });
}

function actionUrl(templateKey: EmailTemplateKey, values: Record<string, string>): string | null {
  const varName = ACTION_URL_VAR[templateKey];
  if (!varName) return null;

  const url = values[varName];
  // Only ever a web link — a `javascript:` URL in a button is how a template
  // var becomes an attack.
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new TemplateRenderError(`Var "${varName}" must be an http(s) URL`);
  }
  return url;
}

export function renderEmail(email: OutgoingEmail): RenderedEmail {
  const catalog = LOCALE_CATALOGS[email.locale];
  const copy = catalog.templates[email.templateKey];
  const values = placeholderValues(email.vars, email.locale);
  const url = actionUrl(email.templateKey, values);

  const subject = interpolate(copy.subject, values);
  const preheader = interpolate(copy.preheader, values);
  const greeting = interpolate(catalog.layout.greeting, values);
  const paragraphs = copy.paragraphs.map((paragraph) => interpolate(paragraph, values));

  const text = [
    greeting,
    ...paragraphs,
    ...(url && copy.action ? [`${copy.action}: ${url}`] : []),
    catalog.layout.signature,
    "—",
    catalog.layout.footer,
  ].join("\n\n");

  const button =
    url && copy.action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(copy.action)}</a></p>`
      : "";

  const html = `<!doctype html>
<html lang="${email.locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px 28px;line-height:1.5;font-size:16px">
<tr><td>
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
${paragraphs.map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`).join("\n")}
${button}
<p style="margin:24px 0 0">${escapeHtml(catalog.layout.signature)}</p>
</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#71717a">${escapeHtml(catalog.layout.footer)}</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
