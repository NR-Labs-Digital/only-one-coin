import { describe, expect, it, vi } from 'vitest'

// dashboard.ts reads the API through these; the functions under test never call them.
vi.mock('./api-client', () => ({ apiFetch: vi.fn() }))
vi.mock('./payments', () => ({ listPaymentReviewQueue: vi.fn() }))

const { seatsHeld, seatsUnderPressure } = await import('./dashboard')
type ClassGroupItem = import('./types').ClassGroupItem

/** Only the fields the seat watch reads; the rest of the row is irrelevant here. */
function group(overrides: Partial<ClassGroupItem> & { id: string }): ClassGroupItem {
  return {
    status: 'enrolling',
    active: true,
    courseActive: true,
    capacity: 30,
    seatsTaken: 0,
    seatsOver: 0,
    startsOn: '2026-12-01T05:00:00.000Z',
    ...overrides,
  } as ClassGroupItem
}

describe('seatsHeld (OOC-155)', () => {
  it('counts the seats above capacity with the regular ones', () => {
    expect(seatsHeld(group({ id: 'a', seatsTaken: 28, seatsOver: 2 }))).toBe(30)
  })
})

describe('seatsUnderPressure (OOC-160)', () => {
  it('ranks a class group with seats above capacity as full, not by its regular seats only', () => {
    const watched = seatsUnderPressure([
      group({ id: 'regular', seatsTaken: 29 }),
      group({ id: 'over', seatsTaken: 28, seatsOver: 3 }),
    ])

    expect(watched.map((item) => item.id)).toEqual(['over', 'regular'])
  })

  it('leaves out what is not on sale', () => {
    const watched = seatsUnderPressure([
      group({ id: 'running', status: 'in_progress', seatsTaken: 30 }),
      group({ id: 'retired', active: false, seatsTaken: 30 }),
      group({ id: 'course-retired', courseActive: false, seatsTaken: 30 }),
      group({ id: 'selling', seatsTaken: 1 }),
    ])

    expect(watched.map((item) => item.id)).toEqual(['selling'])
  })
})
