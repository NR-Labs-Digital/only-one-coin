/**
 * The certificate's deadline (`docs/REGRAS-NEGOCIO.md` §6): a number of
 * business days after the course ends, set in the backoffice
 * (`certificate_deadline_business_days`, OOC-41) and passed in — never a
 * constant here.
 *
 * Who gets the certificate is not decided here: the rule lives in
 * `packages/domain` and runs in the API (OOC-33, CLAUDE.md §8); the screen
 * shows its verdict (`certificate-batch.ts`).
 */

/**
 * Adds business days to a date, weekends only. Peruvian public holidays are NOT
 * subtracted yet — that needs a holiday calendar, and guessing one would make
 * the deadline lie.
 */
export function addBusinessDays(isoDate: string, days: number): Date {
  const date = new Date(`${isoDate}T00:00:00Z`)
  let left = days
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6) left -= 1
  }
  return date
}

/** Business days the institution has left to issue — negative once overdue. */
export function businessDaysUntil(target: Date, from: Date): number {
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  )
  const end = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()),
  )
  const overdue = end < start
  const [a, b] = overdue ? [end, start] : [start, end]
  const cursor = new Date(a)
  let count = 0
  while (cursor < b) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return overdue ? -count : count
}
