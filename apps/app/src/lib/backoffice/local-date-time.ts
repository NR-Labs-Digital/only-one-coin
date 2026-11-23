import { intlLocale, type Locale } from '@/lib/format'

/**
 * An instant typed or read on the panel, in the timezone of whoever is at the
 * screen (OOC-186). The enrollment window is a moment, not a Lima wall clock:
 * staff outside Peru (the team in Portugal) typed "now" in their own hour and
 * got it read as Lima's, five hours later, so the class group stayed off the
 * checkout. The database keeps the instant in UTC (CLAUDE.md §6); only the
 * reading and the typing take the viewer's timezone.
 *
 * Browser-only on purpose: on the server the "local" timezone is the server's.
 * Call these from client components mounted after hydration, or from
 * `LocalDateTime`, which waits for the browser.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-11-23T19:20` (a datetime-local value) → ISO UTC, read in the viewer's timezone. */
export function localDateTimeToIso(value: string): string {
  // A date-time without offset is local time by the ECMAScript spec.
  return new Date(value).toISOString()
}

/** ISO UTC → `YYYY-MM-DDTHH:mm` in the viewer's timezone — the value a datetime-local input wants. */
export function isoToLocalDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `23 nov, 19:20 GMT` — the instant in the viewer's timezone, with the zone named. */
export function formatLocalDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso))
}

/** The viewer's IANA timezone (`Europe/Lisbon`), to label the fields. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
