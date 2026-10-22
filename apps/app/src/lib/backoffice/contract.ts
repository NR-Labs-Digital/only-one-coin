/**
 * What the panel says about a contract. `missing` is a state of its own, not a
 * quiet dash: a teacher running a class group with no contract on file is the
 * same exposure as one whose contract lapsed, and hiding it behind an empty
 * cell is how it stays hidden.
 */
export type ContractAlert = 'missing' | 'expired' | 'expiring' | 'valid'

/**
 * `alertDays` is when a contract stops being somebody's problem for next
 * quarter and starts being one for this week — the backoffice's number
 * (`platform_settings.contract_alert_days`, OOC-41), never a constant here.
 */
export function contractAlert(daysLeft: number | null, alertDays: number): ContractAlert {
  if (daysLeft === null) return 'missing'
  if (daysLeft < 0) return 'expired'
  return daysLeft <= alertDays ? 'expiring' : 'valid'
}

/** Whole days from `now` to an ISO date, negative once it has passed. */
export function daysUntil(isoDate: string, now: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000
  const end = new Date(`${isoDate.slice(0, 10)}T23:59:59Z`).getTime()
  return Math.floor((end - now.getTime()) / DAY_MS)
}
