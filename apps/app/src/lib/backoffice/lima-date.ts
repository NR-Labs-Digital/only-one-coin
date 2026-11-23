/**
 * A date typed on the panel is a day in Lima. Peru keeps UTC−5 all year (no
 * daylight saving), so the offset is a constant, not a timezone lookup — and
 * the database stores the instant in UTC (CLAUDE.md §6, "timestamptz sempre").
 */
const LIMA_OFFSET = '-05:00'
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000

/** `2026-11-02` → the instant Lima's 2 Nov begins, as ISO UTC. */
export function limaDateToIso(date: string): string {
  return new Date(`${date}T00:00:00${LIMA_OFFSET}`).toISOString()
}

/** ISO UTC → `YYYY-MM-DD` as Lima reads it — the value a date input wants. */
export function isoToLimaDate(iso: string): string {
  return new Date(new Date(iso).getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10)
}

/** ISO UTC → `YYYY-MM-DDTHH:mm` as Lima reads it — the value a datetime-local input wants. */
export function isoToLimaDateTime(iso: string): string {
  return new Date(new Date(iso).getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 16)
}
