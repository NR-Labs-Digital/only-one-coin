/**
 * Filters the project adds on top of Liquid's own. Formatting lives here, never
 * in the template text: money is `amount_cents` as an integer and becomes PEN
 * only on the way out; instants render in America/Lima (CLAUDE.md §6).
 */

/** The locales the platform speaks (CLAUDE.md §4). A fourth is one more entry. */
export type TemplateLocale = "es-PE" | "pt-BR" | "en";

export const DEFAULT_TIME_ZONE = "America/Lima";

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DateStyle = "short" | "medium" | "long" | "full";

const DATE_STYLES = new Set<DateStyle>(["short", "medium", "long", "full"]);

/**
 * `{{ payment.amountCents | money }}` → `S/ 25.00` (or the locale's way of
 * writing it). Integer cents in, never a float in the data.
 */
export function money(value: unknown, locale: TemplateLocale): string {
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(cents)) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "PEN" }).format(cents / 100);
}

/**
 * `{{ contract.endsOn | local_date }}` or `| local_date: "short"`.
 *
 * A calendar day (`2026-12-31`) is a day, not an instant — formatted as is,
 * never shifted into the previous evening by a time zone. Anything else is an
 * instant and is shown in `timeZone` (America/Lima by default).
 */
export function localDate(value: unknown, style: unknown, locale: TemplateLocale, timeZone: string): string {
  const dateStyle: DateStyle = DATE_STYLES.has(style as DateStyle) ? (style as DateStyle) : "long";
  if (typeof value === "string" && CALENDAR_DAY.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  }
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone }).format(date);
}
