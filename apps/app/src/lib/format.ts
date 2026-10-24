/**
 * Locale-aware formatters shared by portal and backoffice.
 *
 * Money is PEN from integer cents (never float — CLAUDE.md §5). Dates are
 * stored UTC and rendered in America/Lima (CLAUDE.md §6). These emit
 * numbers/dates only — never UI words, which stay in the locale files.
 */

export type Locale = 'es' | 'en' | 'pt'

const intlLocale: Record<Locale, string> = {
  es: 'es-PE',
  en: 'en-US',
  pt: 'pt-BR',
}

const LIMA_TZ = 'America/Lima'

export function formatMoney(
  amountCents: number,
  currency: string,
  locale: Locale,
): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'currency',
    currency,
  }).format(amountCents / 100)
}

/** A change against a previous figure: "+3", "−2", or a bare "0" when nothing moved. */
export function formatSignedNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], { signDisplay: 'exceptZero' }).format(value)
}

/**
 * The same amount without its symbol, for a file a spreadsheet opens: the
 * currency column is money to the reader and a number to the sheet, and a
 * "S/" in the cell makes it text. Grouping is off for the same reason; the
 * decimal separator stays the reader's, because so is their spreadsheet.
 */
export function formatMoneyPlain(amountCents: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(amountCents / 100)
}

/**
 * The same amount short enough for a chart axis: `S/ 335` instead of
 * `S/ 334,50`. An axis is a scale to place a mark against, not a figure to
 * quote — the exact number lives in the tooltip and in the table.
 */
export function formatMoneyCompact(
  amountCents: number,
  currency: string,
  locale: Locale,
): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amountCents / 100)
}

/** `2026-04-07` — a calendar date with no time, so no timezone to convert. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A date-only value (birth date, course start/end) is rendered as written: it
 * is a calendar date, not an instant. Shifting it into America/Lima would parse
 * it as UTC midnight and print the previous day. Timestamps keep the Lima
 * conversion (CLAUDE.md §6).
 */
export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : LIMA_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

/**
 * The same date as digits — `30/08/2026`. For a table column, where the reader
 * scans dates against each other instead of reading one out loud.
 *
 * The order is day/month/year in every locale, `en-GB` standing in for `en`:
 * `en-US` would print `08/30/2026` and a payment date that flips its order
 * between two tabs of the same portal is a date nobody can trust.
 */
export function formatDateNumeric(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : intlLocale[locale], {
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : LIMA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso))
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: LIMA_TZ,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * A month, from a `2026-08` key: `ago 26`. Short on purpose — it labels a bar
 * in a series, where the full month name would turn the axis into a wall of
 * text. Read as a calendar month, so no timezone conversion applies.
 */
export function formatMonth(monthKey: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit',
  })
    .formatToParts(new Date(`${monthKey}-01T00:00:00Z`))
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value.replace('.', ''))
    .join(' ')
}

export function formatWeekdayTime(
  iso: string,
  locale: Locale,
): { weekday: string; time: string } {
  const d = new Date(iso)
  return {
    weekday: new Intl.DateTimeFormat(intlLocale[locale], {
      timeZone: LIMA_TZ,
      weekday: 'long',
    }).format(d),
    time: new Intl.DateTimeFormat(intlLocale[locale], {
      timeZone: LIMA_TZ,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d),
  }
}

/**
 * Month names in the reader's language, for a date built from three selects.
 *
 * Derived from the locale rather than typed into a locale file: these are the
 * same names `formatDate` already prints, and keeping them in one place is what
 * stops "set." and "Setembro" from disagreeing. Nothing here is a hardcoded
 * string, so the no-UI-copy-in-.ts rule (CLAUDE.md §4) is not in play.
 */
export function monthNames(locale: Locale): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale[locale], {
    month: 'long',
    timeZone: 'UTC',
  })
  return Array.from({ length: 12 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2020, i, 1))),
  )
}

/** Initials for an avatar chip. */
export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

/** Age in whole years, from an ISO date of birth. */
export function ageFrom(birthDateIso: string, now = new Date()): number {
  const born = new Date(birthDateIso)
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - born.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) {
    age -= 1
  }
  return age
}

/**
 * File size for an attachment row. The unit is a symbol, not a word, so it does
 * not belong in the locale files — same reasoning as the currency symbol.
 */
export function formatFileSize(bytes: number, locale: Locale): string {
  const mb = bytes / 1_000_000
  const useMb = mb >= 1
  const value = useMb ? mb : bytes / 1000
  const formatted = new Intl.NumberFormat(intlLocale[locale], {
    maximumFractionDigits: useMb ? 1 : 0,
  }).format(value)
  return `${formatted} ${useMb ? 'MB' : 'KB'}`
}

/**
 * Compact range for a class group: `13 jun → 17 out 2026`. Built from parts so
 * the locale's own field order survives while its connectors ("de", ",") are
 * dropped — a table column has no room for `13 de jun. de 2026`. The year is
 * printed once when both ends share it.
 */
function compactDate(iso: string, locale: Locale, withYear: boolean): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
    .formatToParts(new Date(iso))
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value.replace('.', ''))
    .join(' ')
}

/**
 * A month, from a `2026-08` key, spelled out: `agosto de 2026`. For a filter
 * option, where it is read alone and the short form would look like a typo.
 */
export function formatMonthLong(monthKey: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthKey}-01T00:00:00Z`))
}

export function formatDateRange(
  startIso: string,
  endIso: string,
  locale: Locale,
): string {
  const sameYear = startIso.slice(0, 4) === endIso.slice(0, 4)
  return `${compactDate(startIso, locale, !sameYear)} → ${compactDate(endIso, locale, true)}`
}

/**
 * A plain count, grouped for the locale. Four-digit volumes read as `4128`
 * without it, which is a number nobody scans in a column.
 */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale]).format(value)
}

/**
 * A rate, from the fraction itself — never from a number already multiplied by
 * a hundred. The locale decides the symbol and its spacing.
 */
export function formatPercent(fraction: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(fraction)
}

/**
 * The agenda's titles, from a date-only `YYYY-MM-DD` (a calendar day, so read
 * in UTC — never shifted into Lima). `octubre de 2026` for the month view;
 * `6 – 12 oct 2026` for a week.
 */
export function formatMonthYear(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(/\s/g, ' ')
}

export function formatWeekRange(firstDay: string, lastDay: string, locale: Locale): string {
  /* Not `Intl.formatRange`: Node and the browser disagree on the invisible
     spaces it puts around the dash, and the page fails hydration over a
     character nobody can see. Two plain dates and a fixed dash instead, with
     every exotic space folded to a plain one. */
  const part = (day: string, withYear: boolean) =>
    new Intl.DateTimeFormat(intlLocale[locale], {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' as const } : {}),
    })
      .format(new Date(`${day}T00:00:00Z`))
      .replace(/\s/g, ' ')
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4)
  return `${part(firstDay, !sameYear)} – ${part(lastDay, true)}`
}

/**
 * A timestamp for a file a spreadsheet opens: `2026-09-01 10:00`, in
 * America/Lima. Sortable as text and read as a date by every spreadsheet,
 * whatever the reader's language — unlike `01 sept 10:00`.
 */
export function formatSpreadsheetDateTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: LIMA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}
