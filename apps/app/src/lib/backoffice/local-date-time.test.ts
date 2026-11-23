import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isoToLocalDateTime, localDateTimeToIso } from './local-date-time'

// Node re-reads TZ on change, so each case pins the reader's zone (OOC-186).
let previous: string | undefined
beforeEach(() => {
  previous = process.env.TZ
})
afterEach(() => {
  process.env.TZ = previous
})

describe('enrollment window in the viewer timezone', () => {
  it('reads what someone in Lisbon typed as Lisbon time, not Lima', () => {
    process.env.TZ = 'Europe/Lisbon'
    // 19:20 in Lisbon (UTC+0 in November) — Lima would have made it 00:20 UTC the next day.
    expect(localDateTimeToIso('2026-11-23T19:20')).toBe('2026-11-23T19:20:00.000Z')
  })

  it('reads what someone in Lima typed as Lima time', () => {
    process.env.TZ = 'America/Lima'
    expect(localDateTimeToIso('2026-11-23T19:20')).toBe('2026-11-24T00:20:00.000Z')
  })

  it('shows the same instant in each reader zone', () => {
    const iso = '2026-11-24T00:20:00.000Z'
    process.env.TZ = 'America/Lima'
    expect(isoToLocalDateTime(iso)).toBe('2026-11-23T19:20')
    process.env.TZ = 'Europe/Lisbon'
    expect(isoToLocalDateTime(iso)).toBe('2026-11-24T00:20')
  })

  it('round-trips the input value', () => {
    process.env.TZ = 'America/Sao_Paulo'
    expect(isoToLocalDateTime(localDateTimeToIso('2026-03-05T08:05'))).toBe('2026-03-05T08:05')
  })
})
