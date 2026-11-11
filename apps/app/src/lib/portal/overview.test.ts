import { describe, expect, it } from 'vitest'
import { toEnrollment } from './overview'

type ApiEnrollment = Parameters<typeof toEnrollment>[0]

function enrollmentWith(classroomLinks: { module: number | null; url: string }[] = []): ApiEnrollment {
  return {
    id: 'enr-1',
    code: 'M-0001',
    status: 'active',
    seatStatus: 'confirmed',
    createdAt: '2026-10-01T15:00:00.000Z',
    course: { name: 'Inglés Básico', summary: '', level: 'A1', minAge: 12, requiresCertificationExam: false },
    classGroup: {
      name: 'ING-01',
      teacherName: 'Ana Torres',
      slots: [{ weekday: 'tue', startTime: '19:00', endTime: '20:30' }],
      startsOn: '2026-10-06T05:00:00.000Z',
      endsOn: '2026-12-15T05:00:00.000Z',
      classroomLinks,
    },
    academicPeriodName: 'Ciclo 2026-IV',
    plan: { name: 'Paquete', priceId: 'p-1', priceCents: 6990, currency: 'PEN' },
    payments: [],
    finalGrade: null,
  }
}

describe('toEnrollment — the Classroom quick links (OOC-98, OOC-144)', () => {
  it('carries one link per module, in the order the API sent', () => {
    const links = [
      { module: 1, url: 'https://classroom.google.com/c/m1' },
      { module: 2, url: 'https://classroom.google.com/c/m2' },
    ]
    expect(toEnrollment(enrollmentWith(links)).classGroup.classroomLinks).toEqual(links)
  })

  it('keeps the single link of a class group with no module set', () => {
    const legacy = [{ module: null, url: 'https://classroom.google.com/c/abc' }]
    expect(toEnrollment(enrollmentWith(legacy)).classGroup.classroomLinks).toEqual(legacy)
  })

  it('has no link when the API sent none', () => {
    expect(toEnrollment(enrollmentWith()).classGroup.classroomLinks).toEqual([])
  })

  it('never turns a link off the Classroom host into an href', () => {
    const links = [
      { module: 1, url: 'javascript:alert(1)' },
      { module: 2, url: 'https://evil.example/c/abc' },
      { module: 3, url: 'https://classroom.google.com/c/m3' },
    ]
    expect(toEnrollment(enrollmentWith(links)).classGroup.classroomLinks).toEqual([
      { module: 3, url: 'https://classroom.google.com/c/m3' },
    ])
  })
})

describe('toEnrollment — the final grade (OOC-38)', () => {
  it('carries the posted grade, decimals included', () => {
    const row = { ...enrollmentWith(), finalGrade: { grade: 13.5, didNotSit: false, recordedAt: '2026-12-16T15:00:00.000Z' } }
    expect(toEnrollment(row).finalGrade).toBe(13.5)
  })

  it('reads a DA as did_not_attempt', () => {
    const row = { ...enrollmentWith(), finalGrade: { grade: null, didNotSit: true, recordedAt: '2026-12-16T15:00:00.000Z' } }
    expect(toEnrollment(row).finalGrade).toBe('did_not_attempt')
  })

  it('has none while nothing is posted', () => {
    expect(toEnrollment(enrollmentWith()).finalGrade).toBeNull()
  })
})
