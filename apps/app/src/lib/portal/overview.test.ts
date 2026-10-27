import { describe, expect, it } from 'vitest'
import { toEnrollment } from './overview'

type ApiEnrollment = Parameters<typeof toEnrollment>[0]

function enrollmentWith(classroomUrl: string | null): ApiEnrollment {
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
      classroomUrl,
    },
    academicPeriodName: 'Ciclo 2026-IV',
    plan: { name: 'Paquete', priceId: 'p-1', priceCents: 6990, currency: 'PEN' },
    payments: [],
  }
}

describe('toEnrollment — the class group Classroom (OOC-98)', () => {
  it('carries the link the API sent', () => {
    expect(toEnrollment(enrollmentWith('https://classroom.google.com/c/abc')).classGroup.classroomUrl).toBe(
      'https://classroom.google.com/c/abc',
    )
  })

  it('has no link when the API sent none', () => {
    expect(toEnrollment(enrollmentWith(null)).classGroup.classroomUrl).toBeNull()
  })

  it('never turns a link off the Classroom host into an href', () => {
    expect(toEnrollment(enrollmentWith('javascript:alert(1)')).classGroup.classroomUrl).toBeNull()
    expect(toEnrollment(enrollmentWith('https://evil.example/c/abc')).classGroup.classroomUrl).toBeNull()
  })
})
