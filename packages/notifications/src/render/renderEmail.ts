import type { EmailCopy, EmailTemplateKey, EmailTemplateVars, Locale } from "@ooc/domain";
import en from "../locales/en.json" with { type: "json" };
import esPE from "../locales/es-PE.json" with { type: "json" };
import ptBR from "../locales/pt-BR.json" with { type: "json" };
import type { OutgoingEmail } from "../NotificationProvider.js";

/**
 * The words of one template in one language (`EmailCopy`, `@ooc/domain`):
 * subject, preheader, paragraphs, and — on the templates that have them — the
 * button's label (`action`, only on templates listed in ACTION_URL_VAR), the
 * list's line (`item`, written once per entry of the `items` var where a
 * paragraph is exactly `{items}`, OOC-158), words for vars that carry a code
 * (`values`, OOC-63: a code never reaches the e-mail, CLAUDE.md §4 — a value
 * missing from the map is a bug) and what an optional var says when it is
 * null (`missing`; without it a null var is a bug, and a paragraph whose every
 * placeholder is null is left out — that is how an optional block disappears).
 */
type TemplateCopy = EmailCopy;

export interface LocaleCatalog {
  layout: { greeting: string; signature: string; footer: string };
  /** Marks a proof sent from the e-mail screen (OOC-89). Outside `layout` on
   * purpose: `templateVersion` fingerprints the layout, and the marker of a
   * proof is not part of what the student reads. */
  proof: { subjectPrefix: string };
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
export const ACTION_URL_VAR: Partial<Record<EmailTemplateKey, string>> = {
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
/** Stands for a null var until `interpolate` decides what it says. */
const NULL_VALUE = "\u0000null\u0000";

function placeholderValues(
  vars: EmailTemplateVars[EmailTemplateKey] | Record<string, unknown>,
  locale: Locale,
  copy: TemplateCopy,
): Record<string, string> {
  const intlLocale = INTL_LOCALE[locale];
  const values: Record<string, string> = {};

  for (const [name, value] of Object.entries(vars)) {
    if (value === null) {
      values[name === "amountCents" ? "amount" : name] = NULL_VALUE;
    } else if (copy.values?.[name]) {
      const label = copy.values[name][String(value)];
      if (label === undefined) throw new TemplateRenderError(`Var "${name}" has no label for its value`);
      values[name] = label;
    } else if (name === "filedAt" && typeof value === "string") {
      // An instant: the day and the time it happened, in Lima.
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new TemplateRenderError(`Var "${name}" is not a date`);
      values.filedAt = new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeStyle: "short", timeZone: TIME_ZONE }).format(date);
    } else if (name === "purchasedOn" && typeof value === "string") {
      // A calendar day (YYYY-MM-DD), not an instant: read in UTC so Lima's
      // offset never moves it to the day before.
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) throw new TemplateRenderError(`Var "${name}" is not a date`);
      values.purchasedOn = new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeZone: "UTC" }).format(date);
    } else if (name === "amountCents" && typeof value === "number") {
      values.amount = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "PEN" }).format(value / 100);
    } else if ((name === "startsOn" || name === "endsOn") && typeof value === "string") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new TemplateRenderError(`Var "${name}" is not a date`);
      values[name] = new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeZone: TIME_ZONE }).format(date);
    } else if ((name === "grade" || name === "passingGrade") && typeof value === "number") {
      // A grade as typed, up to two decimals, in the reader's convention (13.5 / 13,5).
      values[name] = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(value);
    } else if (name === "items") {
      // A list, written line by line by `listItems` — never a placeholder.
      continue;
    } else {
      values[name] = String(value);
    }
  }

  return values;
}

/** The paragraph that stands for the list of a template with an `item` line. */
export const ITEMS_PARAGRAPH = "{items}";

/**
 * Each entry of the `items` var through the template's `item` line, its
 * placeholders formatted like any other (a date is a date in the reader's
 * locale). A template that has the list paragraph and no line, or a list var
 * that is not a list, is a template bug.
 */
function listItems(copy: TemplateCopy, vars: Record<string, unknown>, locale: Locale): string[] {
  if (!copy.item) throw new TemplateRenderError(`Template has an ${ITEMS_PARAGRAPH} paragraph and no item line`);
  const items = vars.items;
  if (!Array.isArray(items)) throw new TemplateRenderError('Var "items" is not a list');
  return items.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new TemplateRenderError('An entry of "items" is not an object');
    return interpolate(copy.item!, placeholderValues(entry as Record<string, unknown>, locale, copy), copy);
  });
}

/** A paragraph, or the list it stands for. */
type Block = { kind: "paragraph"; text: string } | { kind: "list"; lines: string[] };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fills `{name}` placeholders. A placeholder with no value is a template
 * bug, not something to send half-written; a null one says the template's
 * `missing` word, and without it is a bug too. */
function interpolate(text: string, values: Record<string, string>, copy: TemplateCopy): string {
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new TemplateRenderError(`Missing value for placeholder "{${name}}"`);
    if (value === NULL_VALUE) {
      if (copy.missing === undefined) throw new TemplateRenderError(`Placeholder "{${name}}" is null`);
      return copy.missing;
    }
    return value;
  });
}

/** A paragraph whose placeholders are all null has nothing to say (OOC-63). */
function isAllNull(text: string, values: Record<string, string>): boolean {
  const names = [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
  return names.length > 0 && names.every((name) => values[name] === NULL_VALUE);
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
  const copy = email.copy ?? catalog.templates[email.templateKey];
  const values = placeholderValues(email.vars, email.locale, copy);
  const url = actionUrl(email.templateKey, values);

  const templateSubject = interpolate(copy.subject, values, copy);
  const subject = email.proof ? `${catalog.proof.subjectPrefix} ${templateSubject}` : templateSubject;
  const preheader = interpolate(copy.preheader, values, copy);
  const greeting = interpolate(catalog.layout.greeting, values, copy);
  const blocks: Block[] = copy.paragraphs
    .filter((paragraph) => !isAllNull(paragraph, values))
    .map((paragraph) =>
      paragraph === ITEMS_PARAGRAPH
        ? { kind: "list", lines: listItems(copy, email.vars as Record<string, unknown>, email.locale) }
        : { kind: "paragraph", text: interpolate(paragraph, values, copy) },
    );

  const text = [
    greeting,
    ...blocks.map((block) => (block.kind === "paragraph" ? block.text : block.lines.map((line) => `• ${line}`).join("\n"))),
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
${blocks
  .map((block) =>
    block.kind === "paragraph"
      ? // A line break typed by a person (the answer to a complaint, OOC-58)
        // stays a line break; it is escaped first, so it is never markup.
        `<p style="margin:0 0 16px">${escapeHtml(block.text).replace(/\r?\n/g, "<br>")}</p>`
      : `<ul style="margin:0 0 16px;padding-left:20px">${block.lines.map((line) => `<li style="margin:0 0 6px">${escapeHtml(line)}</li>`).join("")}</ul>`,
  )
  .join("\n")}
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

/**
 * The e-mail's subject and preheader alone, rendered exactly as in the
 * e-mail — the title and body of the same message sent as a push (OOC-51),
 * so a push never says something the e-mail does not.
 */
export function renderEmailSummary(email: OutgoingEmail): { subject: string; preheader: string } {
  const copy = email.copy ?? LOCALE_CATALOGS[email.locale].templates[email.templateKey];
  const values = placeholderValues(email.vars, email.locale, copy);
  return { subject: interpolate(copy.subject, values, copy), preheader: interpolate(copy.preheader, values, copy) };
}
