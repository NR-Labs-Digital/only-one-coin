import { describe, expect, it } from 'vitest'
import {
  fillTarget,
  resolvePrefill,
  resolveSource,
  whatsappAiArrivalQuery,
  sameOfferGroups,
  scheduleOptionsOnStartDate,
  startDatesOfCourse,
} from './checkout'
import type { CatalogClassGroup, PublicCatalog, WeeklySlot } from './types'

const MWF: WeeklySlot[] = [
  { weekday: 'mon', startTime: '10:00', endTime: '11:30' },
  { weekday: 'wed', startTime: '10:00', endTime: '11:30' },
  { weekday: 'fri', startTime: '10:00', endTime: '11:30' },
]
const TTH: WeeklySlot[] = [
  { weekday: 'tue', startTime: '18:00', endTime: '19:30' },
  { weekday: 'thu', startTime: '18:00', endTime: '19:30' },
]

function group(
  id: string,
  code: string,
  overrides: Partial<CatalogClassGroup> = {},
): CatalogClassGroup {
  return {
    id,
    courseId: 'course-1',
    code,
    slots: MWF,
    startDate: '2026-11-16T00:00:00.000Z',
    endDate: '2026-12-16T00:00:00.000Z',
    capacity: 30,
    seatsTaken: 0,
    ...overrides,
  }
}

function catalogOf(classGroups: CatalogClassGroup[]): PublicCatalog {
  return {
    languages: [{ id: 'lang-1', name: 'Inglés' }],
    courses: [
      {
        id: 'course-1',
        languageId: 'lang-1',
        name: 'Inglés Básico',
        level: 'Básico',
        minAge: 12,
        modules: 6,
        totalHours: 90,
        landingKey: null,
      },
    ],
    plans: [],
    classGroups,
    accounts: [],
    settings: {
      holdMinutes: 15,
      reservationDays: 5,
      maxReceiptBytes: 10_000_000,
      consentVersion: 'v1',
    },
  }
}

const START = '2026-11-16T00:00:00.000Z'

describe('scheduleOptionsOnStartDate', () => {
  it('shows class groups with the same week as one option, seats summed', () => {
    const catalog = catalogOf([
      group('g3', 'A-00003'),
      group('g1', 'A-00001', { seatsTaken: 10 }),
      group('g2', 'A-00002'),
      group('g4', 'A-00004', { slots: TTH }),
    ])
    const options = scheduleOptionsOnStartDate(catalog, 'course-1', START)
    expect(options).toHaveLength(2)
    expect(options[0].groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3'])
    expect(options[0].seatsLeft).toBe(20 + 30 + 30)
  })

  it('treats the same sessions listed in another order as the same week', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001'),
      group('g2', 'A-00002', { slots: [...MWF].reverse() }),
    ])
    expect(scheduleOptionsOnStartDate(catalog, 'course-1', START)).toHaveLength(1)
  })

  it('keeps a different end date as a different offer', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001'),
      group('g2', 'A-00002', { endDate: '2027-01-16T00:00:00.000Z' }),
    ])
    expect(scheduleOptionsOnStartDate(catalog, 'course-1', START)).toHaveLength(2)
  })

  it('orders by code numerically past five digits', () => {
    const catalog = catalogOf([group('big', 'A-100000'), group('small', 'A-99999')])
    const [option] = scheduleOptionsOnStartDate(catalog, 'course-1', START)
    expect(option.groups.map((g) => g.id)).toEqual(['small', 'big'])
  })
})

describe('fillTarget', () => {
  it('fills the first class group before the next one takes anybody', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001', { seatsTaken: 30 }),
      group('g2', 'A-00002', { seatsTaken: 4 }),
      group('g3', 'A-00003'),
    ])
    const [option] = scheduleOptionsOnStartDate(catalog, 'course-1', START)
    expect(fillTarget(option)?.id).toBe('g2')
  })

  it('has no target when every class group of the schedule is full', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001', { seatsTaken: 30 }),
      group('g2', 'A-00002', { seatsTaken: 30 }),
    ])
    const [option] = scheduleOptionsOnStartDate(catalog, 'course-1', START)
    expect(option.seatsLeft).toBe(0)
    expect(fillTarget(option)).toBeNull()
  })
})

describe('sameOfferGroups', () => {
  it('lists the siblings of a class group, itself included, in fill order', () => {
    const catalog = catalogOf([
      group('g2', 'A-00002'),
      group('g1', 'A-00001'),
      group('other', 'A-00003', { slots: TTH }),
    ])
    expect(sameOfferGroups(catalog, 'g2').map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(sameOfferGroups(catalog, 'missing')).toEqual([])
  })
})

describe('startDatesOfCourse', () => {
  it('counts distinct open schedules, not class groups', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001'),
      group('g2', 'A-00002'),
      group('g3', 'A-00003'),
      group('g4', 'A-00004', { slots: TTH, seatsTaken: 30 }),
    ])
    const [date] = startDatesOfCourse(catalog, 'course-1')
    expect(date.openGroups).toBe(1)
    expect(date.seatsLeft).toBe(90)
  })
})

describe('resolvePrefill', () => {
  it('moves a link naming a full class group to a sibling with a seat', () => {
    const catalog = catalogOf([
      group('g1', 'A-00001', { seatsTaken: 30 }),
      group('g2', 'A-00002'),
    ])
    const draft = resolvePrefill(catalog, { course: 'course-1', group: 'g1' })
    expect(draft.classGroupId).toBe('g2')
  })

  it('keeps the named class group while it has a seat', () => {
    const catalog = catalogOf([group('g1', 'A-00001'), group('g2', 'A-00002')])
    const draft = resolvePrefill(catalog, { course: 'course-1', group: 'g2' })
    expect(draft.classGroupId).toBe('g2')
  })
})

describe('resolveSource', () => {
  it('keeps the known channels and turns anything else into web', () => {
    expect(resolveSource('whatsapp')).toBe('whatsapp')
    expect(resolveSource('whatsapp_ai')).toBe('whatsapp_ai')
    expect(resolveSource('WhatsApp')).toBe('web')
    expect(resolveSource('<script>')).toBe('web')
    expect(resolveSource(undefined)).toBe('web')
  })
})

describe('whatsappAiArrivalQuery (OOC-139)', () => {
  it('forces the AI channel and keeps everything else the link carried', () => {
    expect(
      whatsappAiArrivalQuery({ course: 'english', group: ['g-1', 'g-2'], utm_campaign: 'bot' }),
    ).toEqual({ course: 'english', group: 'g-1', utm_campaign: 'bot', src: 'whatsapp_ai' })
  })

  it('overwrites a src on the short link — the path says who sent it', () => {
    expect(whatsappAiArrivalQuery({ src: 'whatsapp' })).toEqual({ src: 'whatsapp_ai' })
  })
})
