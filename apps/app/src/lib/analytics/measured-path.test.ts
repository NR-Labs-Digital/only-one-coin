import { describe, expect, it } from 'vitest'
import { isMeasuredPath } from './measured-path'

const locales = ['es', 'en', 'pt']

describe('isMeasuredPath', () => {
  it('measures the checkout in every locale', () => {
    expect(isMeasuredPath('/enrollment', locales)).toBe(true)
    expect(isMeasuredPath('/en/enrollment', locales)).toBe(true)
    expect(isMeasuredPath('/pt/enrollment/wa', locales)).toBe(true)
  })

  it('never measures the portal, the backoffice or the teacher screens', () => {
    expect(isMeasuredPath('/portal/enrollment', locales)).toBe(false)
    expect(isMeasuredPath('/backoffice/enrollments', locales)).toBe(false)
    expect(isMeasuredPath('/en/docente', locales)).toBe(false)
    expect(isMeasuredPath('/enrollments', locales)).toBe(false)
    expect(isMeasuredPath('/', locales)).toBe(false)
  })
})
