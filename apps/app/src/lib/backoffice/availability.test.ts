import { describe, expect, it } from 'vitest'
import { TIME_OPTIONS } from './availability'

describe('TIME_OPTIONS', () => {
  it('offers every half hour from 06:00 to 23:30', () => {
    expect(TIME_OPTIONS[0]).toBe('06:00')
    expect(TIME_OPTIONS.at(-1)).toBe('23:30')
    expect(TIME_OPTIONS).toContain('22:30')
    expect(TIME_OPTIONS).toHaveLength(36)
  })
})
