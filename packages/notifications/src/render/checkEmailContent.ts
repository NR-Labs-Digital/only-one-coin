import {
  LocaleSchema,
  type EditableEmailKey,
  type EmailCopy,
  type EmailTemplateCheck,
  type EmailTemplateContent,
  type EmailTemplateIssue,
  type EmailTemplateKey,
  type Locale,
} from "@ooc/domain";
import { ACTION_URL_VAR, ITEMS_PARAGRAPH, LOCALE_CATALOGS, TemplateRenderError, renderEmail } from "./renderEmail.js";
import type { OutgoingEmail } from "../NotificationProvider.js";

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The placeholders a template's words may use (OOC-60), read off its vars —
 * the sample the preview renders, which is typed by `EmailTemplateVars` and so
 * carries every var the e-mail is sent with. Money travels as `amountCents` and
 * is written as `{amount}`; the `items` list is not a placeholder, its entries'
 * fields are the list line's; and the button's link is the button's — a link
 * written into the text would go out as a bare address nobody can tell from a
 * phishing one.
 */
export function emailPlaceholders(
  templateKey: EmailTemplateKey,
  vars: object,
): { names: string[]; itemNames: string[] } {
  const names: string[] = [];
  let itemNames: string[] = [];
  for (const [name, value] of Object.entries(vars) as Array<[string, unknown]>) {
    if (name === ACTION_URL_VAR[templateKey]) continue;
    if (name === "items") {
      const first = Array.isArray(value) ? (value[0] as unknown) : undefined;
      itemNames = typeof first === "object" && first !== null ? Object.keys(first) : [];
    } else {
      names.push(name === "amountCents" ? "amount" : name);
    }
  }
  return { names, itemNames };
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/** A brace that is not part of a `{name}` — half a placeholder, which would go out as typed. */
function hasStrayBrace(text: string): boolean {
  return /[{}]/.test(text.replace(PLACEHOLDER, ""));
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === "";
}

/** Every text of a copy with where it lives, and which placeholders it may hold. */
function textsOf(copy: EmailCopy): Array<{ field: string; index?: number; text: string; scope: "top" | "item" | "none" }> {
  const texts: Array<{ field: string; index?: number; text: string; scope: "top" | "item" | "none" }> = [
    { field: "subject", text: copy.subject, scope: "top" },
    { field: "preheader", text: copy.preheader, scope: "top" },
    ...copy.paragraphs
      .map((text, index) => ({ field: "paragraphs", index, text, scope: "top" as const }))
      .filter((entry) => entry.text.trim() !== ITEMS_PARAGRAPH),
  ];
  // The button's label, the null word and the code labels are written as they
  // are — a placeholder in them would reach the student between braces.
  if (copy.action !== undefined) texts.push({ field: "action", text: copy.action, scope: "none" });
  if (copy.item !== undefined) texts.push({ field: "item", text: copy.item, scope: "item" });
  if (copy.missing !== undefined) texts.push({ field: "missing", text: copy.missing, scope: "none" });
  for (const [name, labels] of Object.entries(copy.values ?? {})) {
    for (const [code, label] of Object.entries(labels)) {
      texts.push({ field: `values.${name}.${code}`, text: label, scope: "none" });
    }
  }
  return texts;
}

function checkLocale(
  templateKey: EditableEmailKey,
  locale: Locale,
  copy: EmailCopy,
  vars: Record<string, unknown>,
): EmailTemplateCheck {
  const repository = LOCALE_CATALOGS["es-PE"].templates[templateKey];
  const { names, itemNames } = emailPlaceholders(templateKey, vars);
  const issues: EmailTemplateIssue[] = [];
  const issue = (code: string, extra: Omit<EmailTemplateIssue, "code" | "locale"> = {}) =>
    issues.push({ code, locale, ...extra });

  if (isBlank(copy.subject)) issue("field_empty", { field: "subject" });
  if (isBlank(copy.preheader)) issue("field_empty", { field: "preheader" });
  if (copy.paragraphs.length === 0) issue("no_paragraphs", { field: "paragraphs" });
  copy.paragraphs.forEach((text, index) => {
    if (isBlank(text)) issue("field_empty", { field: "paragraphs", index });
  });

  // The blocks are the repository's: a button only where the code puts a
  // link, a list line only where there is a list, the same code labels.
  for (const field of ["action", "item", "missing"] as const) {
    const expected = repository[field] !== undefined;
    if (expected && isBlank(copy[field])) issue("field_empty", { field });
    if (!expected && copy[field] !== undefined) issue("field_not_allowed", { field });
  }
  for (const [name, labels] of Object.entries(repository.values ?? {})) {
    for (const code of Object.keys(labels)) {
      if (isBlank(copy.values?.[name]?.[code])) issue("field_empty", { field: `values.${name}.${code}` });
    }
  }
  for (const [name, labels] of Object.entries(copy.values ?? {})) {
    for (const code of Object.keys(labels)) {
      if (repository.values?.[name]?.[code] === undefined) issue("field_not_allowed", { field: `values.${name}.${code}` });
    }
  }

  const hasList = repository.paragraphs.includes(ITEMS_PARAGRAPH);
  const listParagraphs = copy.paragraphs.filter((text) => text.trim() === ITEMS_PARAGRAPH).length;
  if (hasList && listParagraphs === 0) issue("items_paragraph_missing", { field: "paragraphs" });
  if (hasList && listParagraphs > 1) issue("items_paragraph_repeated", { field: "paragraphs" });
  if (!hasList && listParagraphs > 0) issue("items_paragraph_not_allowed", { field: "paragraphs" });

  for (const { field, index, text, scope } of textsOf(copy)) {
    const where = index === undefined ? { field } : { field, index };
    if (hasStrayBrace(text)) issue("malformed_placeholder", where);
    const allowed = scope === "top" ? names : scope === "item" ? itemNames : [];
    for (const placeholder of placeholdersIn(text)) {
      if (placeholder === "items" && scope === "top" && hasList) issue("items_inline", { ...where, placeholder });
      else if (!allowed.includes(placeholder)) issue("unknown_placeholder", { ...where, placeholder });
    }
  }

  // The last word is the renderer's: the words over the sample data, the way
  // the worker will write them. Only when nothing above stopped it already.
  if (issues.length === 0) {
    try {
      renderEmail({ to: "preview@example.com", templateKey, locale, vars, copy } as OutgoingEmail);
    } catch (error) {
      if (!(error instanceof TemplateRenderError)) throw error;
      issue("render_failed");
    }
  }

  // A placeholder the repository's words use and these dropped: allowed — the
  // wording is theirs — but worth a look (the course name gone from a payment
  // e-mail is rarely what somebody meant).
  const used = new Set(textsOf(copy).flatMap(({ text }) => placeholdersIn(text)));
  const warnings = [...new Set(textsOf(LOCALE_CATALOGS[locale].templates[templateKey]).flatMap(({ text }) => placeholdersIn(text)))]
    .filter((placeholder) => !used.has(placeholder))
    .map((placeholder) => ({ code: "placeholder_dropped", locale, placeholder }));

  return { issues, warnings };
}

/**
 * Whether a template's edited words can be published (OOC-60): every
 * language present and complete, the repository's blocks and nothing else, no
 * placeholder the e-mail has no value for, and a render over the sample data
 * that goes through. `vars` is the template's sample (`EMAIL_PREVIEW_SAMPLES`).
 */
export function checkEmailContent(
  templateKey: EditableEmailKey,
  content: EmailTemplateContent,
  vars: object,
): EmailTemplateCheck {
  const issues: EmailTemplateIssue[] = [];
  const warnings: EmailTemplateIssue[] = [];
  for (const locale of LocaleSchema.options) {
    const copy = content[locale];
    if (!copy) {
      issues.push({ code: "locale_missing", locale });
      continue;
    }
    const check = checkLocale(templateKey, locale, copy, vars as Record<string, unknown>);
    issues.push(...check.issues);
    warnings.push(...check.warnings);
  }
  return { issues, warnings };
}

/** The repository's words of a template, in every language — the editor's starting point. */
export function repositoryEmailContent(templateKey: EditableEmailKey): Record<Locale, EmailCopy> {
  return Object.fromEntries(
    LocaleSchema.options.map((locale) => [locale, LOCALE_CATALOGS[locale].templates[templateKey]]),
  ) as Record<Locale, EmailCopy>;
}
