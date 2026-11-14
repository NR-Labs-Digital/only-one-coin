import { describe, expect, it } from 'vitest'
import { enrollmentLinks } from './links'

describe('enrollmentLinks (OOC-139)', () => {
  it('points the backoffice domain at the student domain, where the checkout lives', () => {
    expect(enrollmentLinks('https://backoffice.onlyonecoin.edu.pe')).toEqual({
      web: 'https://student.onlyonecoin.edu.pe/enrollment',
      whatsapp_ai: 'https://student.onlyonecoin.edu.pe/enrollment/wa',
    })
  })

  it('keeps the origin anywhere else — local, preview, staging serve both', () => {
    expect(enrollmentLinks('http://localhost:3000')).toEqual({
      web: 'http://localhost:3000/enrollment',
      whatsapp_ai: 'http://localhost:3000/enrollment/wa',
    })
  })
})
