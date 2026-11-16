import { describe, expect, it } from 'vitest'
import {
  groupOffers,
  offerSeatsLeft,
  parsePickerValue,
  pickerValue,
  resolvePick,
  type OfferMember,
} from './class-group-offers'

const TUESDAY = [{ weekday: 'tue', startTime: '18:00', endTime: '19:30' }]

function member(overrides: Partial<OfferMember> & { id: string; code: string }): OfferMember {
  return {
    classGroupId: overrides.id,
    courseId: 'course-1',
    academicPeriodId: 'period-1',
    startsOn: '2026-12-01T05:00:00.000Z',
    endsOn: '2027-01-31T05:00:00.000Z',
    slots: TUESDAY,
    capacity: 30,
    seatsTaken: 0,
    seatsOver: 0,
    ...overrides,
  }
}

describe('groupOffers (OOC-145)', () => {
  it('puts class groups of one course, period, dates and week in one choice, in code order', () => {
    const offers = groupOffers([
      member({ id: 'b', code: 'A-00010' }),
      member({ id: 'a', code: 'A-00009' }),
      member({ id: 'sat', code: 'A-00011', slots: [{ weekday: 'sat', startTime: '09:00', endTime: '10:30' }] }),
    ])

    expect(offers.map((offer) => offer.members.map((item) => item.code))).toEqual([['A-00009', 'A-00010'], ['A-00011']])
  })

  it('keeps another period, other dates and another module apart', () => {
    const offers = groupOffers([
      member({ id: 'a', code: 'A-1' }),
      member({ id: 'other-period', code: 'A-2', academicPeriodId: 'period-2' }),
      member({ id: 'other-dates', code: 'A-3', startsOn: '2026-12-08T05:00:00.000Z' }),
      member({ id: 'module-2', code: 'A-4', module: 2 }),
    ])
    expect(offers).toHaveLength(4)
  })

  it('lists the run of the class group the seat is in first', () => {
    const offers = groupOffers(
      [
        member({ id: 'run-b', classGroupId: 'b', code: 'A-1', module: 2 }),
        member({ id: 'run-own', classGroupId: 'own', code: 'A-9', module: 2 }),
      ],
      'own',
    )
    expect(offers[0]!.members.map((item) => item.id)).toEqual(['run-own', 'run-b'])
  })

  it('never groups a class group without dates', () => {
    const offers = groupOffers([
      member({ id: 'a', code: 'A-1', startsOn: null }),
      member({ id: 'b', code: 'A-2', startsOn: null }),
    ])
    expect(offers).toHaveLength(2)
  })
})

describe('picker values', () => {
  it('round-trips the schedule and the class group', () => {
    expect(parsePickerValue(pickerValue('schedule', 'x'))).toEqual({ placement: 'schedule', id: 'x' })
    expect(parsePickerValue(pickerValue('class_group', 'x'))).toEqual({ placement: 'class_group', id: 'x' })
    expect(parsePickerValue('')).toBeNull()
  })

  it('resolves a value to its offer and member, and nothing for a stale one', () => {
    const offers = groupOffers([member({ id: 'a', code: 'A-1' }), member({ id: 'b', code: 'A-2' })])
    const picked = resolvePick(offers, pickerValue('schedule', 'a'))
    expect(picked?.placement).toBe('schedule')
    expect(picked?.offer.members).toHaveLength(2)
    expect(resolvePick(offers, 'gone')).toBeNull()
  })
})

describe('offerSeatsLeft', () => {
  it('sums the regular seats and never counts a class group above capacity as room', () => {
    expect(
      offerSeatsLeft([
        member({ id: 'a', code: 'A-1', capacity: 2, seatsTaken: 1 }),
        member({ id: 'b', code: 'A-2', capacity: 2, seatsTaken: 2, seatsOver: 1 }),
      ]),
    ).toBe(1)
  })
})
